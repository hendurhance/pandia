use serde::Serialize;
use serde_json::error::Category;

use super::detect::{detect_and_convert, DetectKind};
use super::repair;

const EXCERPT_RADIUS: usize = 34;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub title: String,
    pub detail: String,
    pub excerpt: Option<DiagnosisExcerpt>,
    pub fix: Option<DiagnosisFix>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisExcerpt {
    pub text: String,
    pub caret: u32,
    pub line: u32,
    pub column: u32,
    pub clipped_start: bool,
    pub clipped_end: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisFix {
    pub label: String,
    pub text: String,
    pub warnings: Vec<String>,
}

pub fn diagnose(text: &str, fixable: bool) -> Diagnosis {
    if text.trim().is_empty() {
        return Diagnosis {
            title: "Nothing to load".into(),
            detail: "The text is empty.".into(),
            excerpt: None,
            fix: None,
        };
    }

    let Err(err) = repair::check_json(text) else {
        return Diagnosis {
            title: "This is valid JSON".into(),
            detail: "Nothing to fix — try loading it again.".into(),
            excerpt: None,
            fix: None,
        };
    };

    if let Some(d) = fixable.then(|| convertible_format(text)).flatten() {
        return d;
    }

    let offset = offset_of(text, err.line(), err.column());
    let (title, detail) = explain(text, &err, offset);

    Diagnosis {
        title,
        detail,
        excerpt: build_excerpt(text, offset, err.line() as u32, err.column() as u32),
        fix: fixable.then(|| repair_fix(text)).flatten(),
    }
}

fn convertible_format(text: &str) -> Option<Diagnosis> {
    let d = detect_and_convert(text);
    if d.error.is_some() {
        return None;
    }
    let (name, action) = match d.kind {
        DetectKind::Yaml => ("YAML", "Convert from YAML"),
        DetectKind::Xml => ("XML", "Convert from XML"),
        DetectKind::Csv => ("CSV", "Convert from CSV"),
        DetectKind::Curl => ("a cURL command", "Convert the request"),
        DetectKind::Json | DetectKind::Unknown => return None,
    };
    Some(Diagnosis {
        title: format!("This looks like {name}, not JSON"),
        detail: "Pandia can convert it — the result opens as JSON.".into(),
        excerpt: None,
        fix: Some(DiagnosisFix {
            label: action.into(),
            text: d.json,
            warnings: Vec::new(),
        }),
    })
}

fn repair_fix(text: &str) -> Option<DiagnosisFix> {
    let r = repair::repair(text)?;
    Some(DiagnosisFix {
        label: "Repair and load".into(),
        text: r.json,
        warnings: r.notes,
    })
}

fn explain(text: &str, err: &serde_json::Error, offset: usize) -> (String, String) {
    let at = text[offset..].chars().next();

    if err.classify() == Category::Eof {
        return (
            "The document is cut off".into(),
            "It ends part-way through a value — an opening { [ or \" was never closed. \
             This usually means the copy was truncated."
                .into(),
        );
    }

    let msg = err.to_string();

    if msg.starts_with("trailing characters") {
        return (
            "Extra content after the JSON ends".into(),
            format!(
                "The document is complete by line {}, but there is more text after it.",
                err.line()
            ),
        );
    }
    if msg.starts_with("key must be a string") {
        return match at {
            Some(c @ ('}' | ']')) => (
                "One comma too many".into(),
                format!("There is a comma just before {c}. JSON does not allow a trailing comma."),
            ),
            Some(c @ ('\'' | '`' | '\u{2018}' | '\u{201c}')) => (
                format!("Property names are wrapped in {c}"),
                "JSON only accepts double quotes. This looks like a Python dict or a JavaScript \
                 object literal rather than JSON."
                    .into(),
            ),
            _ => (
                "A property name is not quoted".into(),
                "JSON needs double quotes around every property name, including numeric ones."
                    .into(),
            ),
        };
    }
    if msg.starts_with("invalid escape") {
        return (
            "Invalid escape inside a string".into(),
            "A backslash must be followed by one of \" \\ / b f n r t or u.".into(),
        );
    }
    if msg.starts_with("unexpected end of hex escape") || msg.starts_with("lone leading surrogate")
    {
        return (
            "A broken character escape".into(),
            "A \\u escape holds only half of a character, often an emoji that was cut in two. \
             Delete it, or repair the file to replace it with �."
                .into(),
        );
    }
    if msg.starts_with("control character") {
        return (
            "A line break inside a string".into(),
            "Strings cannot span lines. Use \\n for a newline and \\t for a tab.".into(),
        );
    }

    let mid_word =
        at.is_some_and(char::is_alphanumeric) && text[..offset].ends_with(char::is_alphanumeric);
    if msg.starts_with("expected `,` or") && !mid_word && !matches!(at, Some('}' | ']')) {
        return (
            "A comma is missing before this".into(),
            "Items in an object or array are separated by commas. Add a comma between this \
             and the value before it."
                .into(),
        );
    }
    if msg.starts_with("expected `:`") {
        return (
            "A colon is missing before this".into(),
            "A property name is followed by a colon and then its value, like \"name\": 1. \
             Add the colon after the name."
                .into(),
        );
    }

    match at {
        Some(c @ ('\'' | '`' | '\u{2018}' | '\u{2019}' | '\u{201c}' | '\u{201d}')) => (
            format!("Unexpected {c} here"),
            "JSON only uses double quotes (\"). This looks like text copied out of code or a \
             spreadsheet, which wraps it in the wrong quote."
                .into(),
        ),
        Some(c) if c.is_alphabetic() => {
            let (start, word) = word_around(text, offset);
            if start == 0 && !text.contains(['{', '[']) {
                (
                    "This does not look like JSON".into(),
                    "Pandia also reads YAML, XML, CSV and cURL commands — paste one of those, or \
                     open a file instead."
                        .into(),
                )
            } else {
                (
                    format!("`{word}` is not a JSON value"),
                    "Text has to be in double quotes. Only true, false and null are allowed bare."
                        .into(),
                )
            }
        }
        Some(c @ ('}' | ']')) => match text[..offset].trim_end().chars().next_back() {
            Some(',') => (
                "One comma too many".into(),
                format!("There is a comma with nothing after it, just before {c}."),
            ),
            Some(':') => (
                "A property has no value".into(),
                "There is a name and a colon here, but nothing after them.".into(),
            ),
            _ => (
                format!("Unexpected {c} here"),
                format!("{c} arrives where a value was expected."),
            ),
        },
        Some(',') => (
            "One comma too many".into(),
            "There is a comma where a value should be — usually a spare one before } or ].".into(),
        ),
        Some(c) if c.is_control() || is_invisible(c) => (
            "An invisible character is in the way".into(),
            format!(
                "There is a hidden character (U+{:04X}) here. It usually arrives with a copy \
                 from a browser, chat window or PDF.",
                c as u32
            ),
        ),
        Some(c) => (
            format!("Unexpected {c} here"),
            "A JSON value starts with {, [, a double quote, a digit, true, false or null.".into(),
        ),
        None => (
            "The document is cut off".into(),
            "It ends where a value was expected.".into(),
        ),
    }
}

fn word_around(text: &str, offset: usize) -> (usize, String) {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let start = text[..offset]
        .char_indices()
        .rev()
        .take_while(|(_, c)| is_word(*c))
        .last()
        .map(|(i, _)| i)
        .unwrap_or(offset);
    let word = text[start..]
        .chars()
        .take_while(|c| is_word(*c))
        .take(16)
        .collect();
    (start, word)
}

fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{feff}' | '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{00a0}' | '\u{2028}' | '\u{2029}'
    )
}

fn offset_of(text: &str, line: usize, column: usize) -> usize {
    let mut offset = 0;
    for (n, l) in text.split_inclusive('\n').enumerate() {
        if n + 1 == line {
            let col = column.saturating_sub(1).min(l.trim_end_matches('\n').len());
            return offset + l.floor_char_boundary(col);
        }
        offset += l.len();
    }
    text.len()
}

fn build_excerpt(text: &str, offset: usize, line: u32, column: u32) -> Option<DiagnosisExcerpt> {
    if text.is_empty() {
        return None;
    }
    let offset = offset.min(text.len());

    let start = text[..offset]
        .char_indices()
        .rev()
        .take_while(|&(_, c)| c != '\n')
        .take(EXCERPT_RADIUS)
        .last()
        .map_or(offset, |(i, _)| i);

    let end = text[offset..]
        .char_indices()
        .take_while(|&(i, c)| c != '\n' && (i == 0 || !text[offset + i..].starts_with("\r\n")))
        .take(EXCERPT_RADIUS)
        .last()
        .map_or(offset, |(i, c)| offset + i + c.len_utf8());

    Some(DiagnosisExcerpt {
        text: text[start..end].chars().map(visible).collect(),
        caret: text[start..offset].chars().count() as u32,
        line,
        column,
        clipped_start: text[..start].ends_with(|c: char| c != '\n'),
        clipped_end: text[end..].starts_with(|c: char| c != '\n')
            && !text[end..].starts_with("\r\n"),
    })
}

fn visible(c: char) -> char {
    if c == '\t' {
        return '→';
    }
    if c.is_control() || is_invisible(c) {
        return '·';
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(text: &str) -> Diagnosis {
        diagnose(text, true)
    }

    #[test]
    fn empty_input_says_so() {
        assert_eq!(d("   \n ").title, "Nothing to load");
        assert!(d("").fix.is_none());
    }

    #[test]
    fn valid_json_is_reported_as_valid() {
        assert_eq!(d(r#"{"a": 1}"#).title, "This is valid JSON");
    }

    #[test]
    fn stray_quote_is_named_not_coordinates() {
        let r = d("'{\"a\": 1}");
        assert_eq!(r.title, "Unexpected ' here");
        assert!(r.detail.contains("double quotes"), "{}", r.detail);
    }

    #[test]
    fn bare_word_quotes_the_offending_word() {
        let r = d(r#"{"a": hello}"#);
        assert_eq!(r.title, "`hello` is not a JSON value");
    }

    #[test]
    fn truncated_document_is_named() {
        let r = d(r#"{"a": {"b": 1"#);
        assert_eq!(r.title, "The document is cut off");
    }

    #[test]
    fn unescaped_newline_in_a_string() {
        let r = d("{\"a\": \"one\ntwo\"}");
        assert_eq!(r.title, "A line break inside a string");
    }

    #[test]
    fn excerpt_carries_a_caret_on_the_failing_char() {
        let r = d("{\"a\": 1, \"b\": }").excerpt.expect("excerpt");
        let at = r
            .text
            .chars()
            .nth(r.caret as usize)
            .expect("caret in range");
        assert_eq!(at, '}', "caret should land on the offending character");
        assert!(!r.clipped_start);
    }

    #[test]
    fn excerpt_clips_long_lines_around_the_caret() {
        let pad = "x".repeat(400);
        let r = d(&format!("{{\"a\": \"{pad}\", \"b\": }}"))
            .excerpt
            .expect("excerpt");
        assert!(r.clipped_start, "start of a long line should be clipped");
        assert!(r.text.chars().count() <= EXCERPT_RADIUS * 2);
        assert_eq!(r.text.chars().nth(r.caret as usize), Some('}'));
    }

    #[test]
    fn caret_lands_on_the_right_line_of_a_multi_line_document() {
        let r = d("{\n  \"a\": 1,\n  \"b\": ]\n}").excerpt.expect("excerpt");
        assert_eq!(r.line, 3);
        assert_eq!(r.text.chars().nth(r.caret as usize), Some(']'));
    }

    #[test]
    fn invisible_characters_get_a_visible_stand_in() {
        let r = d("{\"a\": \u{200b}}").excerpt.expect("excerpt");
        assert!(r.text.contains('·'), "{:?}", r.text);
        assert_eq!(r.text.chars().nth(r.caret as usize), Some('·'));
    }

    #[test]
    fn crlf_line_endings_stay_out_of_the_excerpt() {
        let r = d("{\r\n  \"a\": 1,\r\n  \"b\": ]\r\n}")
            .excerpt
            .expect("excerpt");
        assert_eq!(r.text, "  \"b\": ]");
        assert!(!r.clipped_end);
        let r = d("{\"a\": \"one\r\ntwo\"}").excerpt.expect("excerpt");
        assert_eq!(r.text.chars().nth(r.caret as usize), Some('·'));
    }

    #[test]
    fn trailing_comma_is_named_as_such() {
        assert_eq!(d(r#"{"a": 1, "b": 2,}"#).title, "One comma too many");
        assert_eq!(d(r#"[1, 2,]"#).title, "One comma too many");
    }

    #[test]
    fn missing_value_is_not_confused_with_a_trailing_comma() {
        assert_eq!(d(r#"{"a": 1, "b": }"#).title, "A property has no value");
    }

    #[test]
    fn python_dict_is_recognised_by_its_quotes() {
        let r = d("{'a': 1, 'b': 2}");
        assert_eq!(r.title, "Property names are wrapped in '");
        assert!(r.detail.contains("Python"), "{}", r.detail);
    }

    #[test]
    fn prose_is_not_told_to_add_quotes() {
        let r = d("sorry mate here is the data i mentioned");
        assert_eq!(r.title, "This does not look like JSON");
    }

    #[test]
    fn a_bare_word_inside_an_object_still_names_the_word() {
        assert_eq!(
            d(r#"{"status": pending}"#).title,
            "`pending` is not a JSON value"
        );
    }

    #[test]
    fn convertible_formats_are_named_and_offered() {
        for (text, want_title, want_label) in [
            (
                "name: pandia\nversion: 1.0.4\ntags:\n  - a\n",
                "This looks like YAML, not JSON",
                "Convert from YAML",
            ),
            (
                "<order id=\"1\"><area>245</area></order>",
                "This looks like XML, not JSON",
                "Convert from XML",
            ),
            (
                "id,name,area\n1,alpha,245\n2,beta,1.25\n",
                "This looks like CSV, not JSON",
                "Convert from CSV",
            ),
            (
                "curl 'https://api.example.com/x' -H 'Accept: application/json'",
                "This looks like a cURL command, not JSON",
                "Convert the request",
            ),
        ] {
            let r = d(text);
            assert_eq!(r.title, want_title);
            let fix = r.fix.expect("conversion offered");
            assert_eq!(fix.label, want_label);
            serde_json::from_str::<serde_json::Value>(&fix.text)
                .unwrap_or_else(|e| panic!("{want_label} produced invalid JSON: {e}"));
        }
    }

    #[test]
    fn a_bad_literal_names_the_whole_word_not_its_tail() {
        assert_eq!(d(r#"{"a": nope}"#).title, "`nope` is not a JSON value");
        assert_eq!(
            d(r#"{"a": trueish}"#).title,
            "`trueish` is not a JSON value"
        );
        assert_eq!(d(r#"{"a": False}"#).title, "`False` is not a JSON value");
    }

    #[test]
    fn jsonp_with_a_semicolon_is_repairable() {
        let fix = d(r#"callback({"a": 1});"#)
            .fix
            .expect("jsonp is repairable");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fix.text).unwrap(),
            serde_json::json!({"a": 1})
        );
    }

    #[test]
    fn repairable_input_offers_a_fix() {
        let fix = d(r#"{a: 1, "b": 2,}"#).fix.expect("repairable");
        assert_eq!(fix.label, "Repair and load");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fix.text).unwrap(),
            serde_json::json!({"a": 1, "b": 2})
        );
    }

    #[test]
    fn a_lone_surrogate_is_named_and_offered_a_repair() {
        let r = d(r#"{"a": "\ud83d"}"#);
        assert_eq!(r.title, "A broken character escape");
        let fix = r.fix.expect("repairable");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fix.text).unwrap(),
            serde_json::json!({"a": "\u{fffd}"})
        );
    }

    #[test]
    fn a_multi_byte_character_earlier_on_the_line_does_not_move_the_caret() {
        assert_eq!(
            d(r#"{"name": "café", "x": }"#).title,
            "A property has no value"
        );
        let r = d(r#"{"n": "😀😀😀", "x": ]}"#).excerpt.expect("excerpt");
        assert_eq!(r.text.chars().nth(r.caret as usize), Some(']'));
    }

    #[test]
    fn a_missing_comma_is_named() {
        for text in [
            r#"{"a": 1 "b": 2}"#,
            "[1 2]",
            "{\n  \"a\": 1\n  \"b\": 2\n}",
        ] {
            let r = d(text);
            assert_eq!(r.title, "A comma is missing before this", "{text}");
            assert!(r.detail.contains("Add a comma"), "{}", r.detail);
        }
        assert_ne!(d(r#"{"a": 1]"#).title, "A comma is missing before this");
    }

    #[test]
    fn a_missing_colon_is_named() {
        let r = d(r#"{"a" 1}"#);
        assert_eq!(r.title, "A colon is missing before this");
        assert!(r.detail.contains("Add the colon"), "{}", r.detail);
    }

    #[test]
    fn unrepairable_input_offers_no_fix() {
        assert!(d("not json at all, just prose").fix.is_none());
    }

    #[test]
    fn the_excerpt_of_a_long_line_is_clipped_around_the_caret() {
        let text = format!("[{}]", "1,".repeat(500_000));
        let offset = text.len() - 1;
        let r = build_excerpt(&text, offset, 1, offset as u32 + 1).expect("excerpt");
        assert_eq!(r.text.chars().nth(r.caret as usize), Some(']'));
        assert!(r.clipped_start);
    }
}
