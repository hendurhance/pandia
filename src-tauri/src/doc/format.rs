use std::borrow::Cow;
use std::path::Path as FsPath;

use serde::de::IgnoredAny;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputFormat {
    Ndjson,
    Relaxed,
}

pub fn hint_from_path(path: &str) -> Option<InputFormat> {
    let ext = FsPath::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    match ext.as_str() {
        "ndjson" | "jsonl" => Some(InputFormat::Ndjson),
        "jsonc" | "json5" => Some(InputFormat::Relaxed),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recovered {
    pub json: String,
    pub note: Option<&'static str>,
    pub comments_stripped: bool,
}

pub const COMMENTS_STRIPPED_NOTE: &str =
    "Removed the comments — saving will write plain JSON without them";

impl Recovered {
    fn noted(json: String, note: &'static str) -> Self {
        Self {
            json,
            note: Some(note),
            comments_stripped: false,
        }
    }
}

pub fn recover(text: &str, hint: Option<InputFormat>) -> Option<Recovered> {
    let (body, note) = strip_leading_junk(text);
    if let Some(note) = note {
        if is_valid_json(body) {
            return Some(Recovered::noted(body.to_string(), note));
        }
    }
    if let Some(unwrapped) = unwrap_quoted(body) {
        if is_valid_json(&unwrapped.json) {
            return Some(unwrapped);
        }
    }

    let attempts = if hint == Some(InputFormat::Relaxed) {
        [Attempt::Relaxed, Attempt::Ndjson, Attempt::RelaxedNdjson]
    } else {
        [Attempt::Ndjson, Attempt::Relaxed, Attempt::RelaxedNdjson]
    };

    let dialect = attempts.into_iter().find_map(|attempt| {
        let (json, comments) = match attempt {
            Attempt::Ndjson => (ndjson_to_array(body)?, false),
            Attempt::Relaxed => relaxed_to_json(body)?,
            Attempt::RelaxedNdjson => {
                let (json, comments) = relaxed_to_json(body)?;
                (ndjson_to_array(&json)?, comments)
            }
        };
        is_valid_json(&json).then_some((json, comments))
    });
    if let Some((json, comments_stripped)) = dialect {
        let note = if comments_stripped {
            Some(COMMENTS_STRIPPED_NOTE)
        } else {
            note
        };
        return Some(Recovered {
            json,
            note,
            comments_stripped,
        });
    }

    let inner = unwrap_quoted(body)?;
    let (json, comments_stripped) = relaxed_to_json(&inner.json)
        .or_else(|| ndjson_to_array(&inner.json).map(|json| (json, false)))
        .filter(|(c, _)| is_valid_json(c))?;
    Some(Recovered {
        json,
        note: inner.note,
        comments_stripped,
    })
}

const LEADING_JUNK: &[char] = &[
    '\u{feff}', // byte order mark
    '\u{200b}', // zero-width space
    '\u{200c}', // zero-width non-joiner
    '\u{200d}', // zero-width joiner
    '\u{2060}', // word joiner
    '\u{200e}', // left-to-right mark
    '\u{200f}', // right-to-left mark
    '\u{00a0}', // non-breaking space
    '\u{0000}', // NUL
];

fn strip_leading_junk(text: &str) -> (&str, Option<&'static str>) {
    let body = text.trim_start_matches(LEADING_JUNK);
    if body.len() == text.len() {
        return (text, None);
    }
    (
        body,
        Some("Removed an invisible character before the first value"),
    )
}

fn closing_quote_for(open: char) -> Option<char> {
    match open {
        '\'' => Some('\''),
        '"' => Some('"'),
        '`' => Some('`'),
        '\u{2018}' => Some('\u{2019}'), // ‘ ’
        '\u{201c}' => Some('\u{201d}'), // “ ”
        _ => None,
    }
}

fn is_closing_quote(c: char) -> bool {
    matches!(c, '\'' | '"' | '`' | '\u{2019}' | '\u{201d}')
}

fn unwrap_quoted(text: &str) -> Option<Recovered> {
    let trimmed = text.trim();
    let mut chars = trimmed.chars();
    let first = chars.next()?;
    let last = chars.next_back()?; // None for a 1-char input: nothing to unwrap

    let (inner, note, was_double) = match (closing_quote_for(first), is_closing_quote(last)) {
        (Some(expected), true) if last == expected => (
            &trimmed[first.len_utf8()..trimmed.len() - last.len_utf8()],
            "Removed the quotes wrapping the document — it was quoted text, not JSON",
            first == '"',
        ),
        (Some(_), _) => (
            &trimmed[first.len_utf8()..],
            "Removed a stray quote before the first value",
            false,
        ),
        (None, true) => (
            &trimmed[..trimmed.len() - last.len_utf8()],
            "Removed a stray quote after the last value",
            false,
        ),
        _ => return None,
    };

    let inner = inner.trim();
    if inner.is_empty() {
        return None;
    }
    let json = if was_double && inner.contains("\\\"") {
        super::repair::unescape(inner)
    } else {
        inner.to_string()
    };
    Some(Recovered::noted(json, note))
}

#[derive(Clone, Copy)]
enum Attempt {
    Ndjson,
    Relaxed,
    RelaxedNdjson,
}

fn is_valid_json(text: &str) -> bool {
    serde_json::from_str::<IgnoredAny>(text).is_ok()
}

fn top_level_spans(text: &str) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;

    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == 0x1e) {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        let start = i;
        match b[i] {
            b'{' | b'[' => {
                let mut depth = 0i32;
                let mut in_str = false;
                let mut esc = false;
                while i < b.len() {
                    let c = b[i];
                    if in_str {
                        if esc {
                            esc = false;
                        } else if c == b'\\' {
                            esc = true;
                        } else if c == b'"' {
                            in_str = false;
                        }
                    } else {
                        match c {
                            b'"' => in_str = true,
                            b'{' | b'[' => depth += 1,
                            b'}' | b']' => {
                                depth -= 1;
                                if depth == 0 {
                                    i += 1;
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    i += 1;
                }
            }
            b'"' => {
                i += 1;
                let mut esc = false;
                while i < b.len() {
                    let c = b[i];
                    if esc {
                        esc = false;
                    } else if c == b'\\' {
                        esc = true;
                    } else if c == b'"' {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            _ => {
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != 0x1e {
                    i += 1;
                }
            }
        }
        spans.push((start, i));
    }
    spans
}

fn ndjson_to_array(text: &str) -> Option<String> {
    let spans = top_level_spans(text);
    if spans.len() < 2 {
        return None;
    }
    let payload: usize = spans.iter().map(|(a, b)| b - a).sum();
    let mut out = String::with_capacity(payload + spans.len() + 1);
    out.push('[');
    for (n, &(a, b)) in spans.iter().enumerate() {
        if n > 0 {
            out.push(',');
        }
        out.push_str(&text[a..b]);
    }
    out.push(']');
    Some(out)
}

#[derive(Debug, Clone, Copy)]
enum Ctx {
    Obj { key_pos: bool },
    Arr,
}

fn relaxed_to_json(text: &str) -> Option<(String, bool)> {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut stack: Vec<Ctx> = Vec::new();
    let mut changed = false;
    let mut saw_comment = false;
    let mut i = 0;

    while i < b.len() {
        match b[i] {
            b'/' if b.get(i + 1) == Some(&b'/') => {
                changed = true;
                saw_comment = true;
                i += 2;
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                changed = true;
                saw_comment = true;
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    if b[i] == b'\n' {
                        out.push('\n');
                    }
                    i += 1;
                }
                i = (i + 2).min(b.len());
            }
            b'"' => i = copy_double_quoted(text, i, &mut out, &mut changed),
            b'\'' => {
                changed = true;
                i = copy_single_quoted(text, i, &mut out, &mut changed);
            }
            b'{' => {
                out.push('{');
                stack.push(Ctx::Obj { key_pos: true });
                i += 1;
            }
            b'[' => {
                out.push('[');
                stack.push(Ctx::Arr);
                i += 1;
            }
            c @ (b'}' | b']') => {
                changed |= drop_trailing_comma(&mut out);
                out.push(c as char);
                stack.pop();
                i += 1;
            }
            b':' => {
                out.push(':');
                if let Some(Ctx::Obj { key_pos }) = stack.last_mut() {
                    *key_pos = false;
                }
                i += 1;
            }
            b',' => {
                out.push(',');
                if let Some(Ctx::Obj { key_pos }) = stack.last_mut() {
                    *key_pos = true;
                }
                i += 1;
            }
            c if c.is_ascii_whitespace() => {
                out.push(c as char);
                i += 1;
            }
            _ => {
                let start = i;
                while i < b.len() && !is_token_delim(b[i]) {
                    i += 1;
                }
                if i == start {
                    out.push(b[i] as char);
                    i += 1;
                    continue;
                }
                changed |= emit_bare_token(&text[start..i], &stack, &mut out);
            }
        }
    }

    changed.then_some((out, saw_comment))
}

fn is_token_delim(c: u8) -> bool {
    c.is_ascii_whitespace()
        || matches!(
            c,
            b'{' | b'}' | b'[' | b']' | b':' | b',' | b'"' | b'\'' | b'/'
        )
}

fn emit_bare_token(tok: &str, stack: &[Ctx], out: &mut String) -> bool {
    if matches!(stack.last(), Some(Ctx::Obj { key_pos: true })) {
        push_json_string(tok, out);
        return true;
    }
    match tok {
        "true" | "false" | "null" => {
            out.push_str(tok);
            false
        }
        "Infinity" | "-Infinity" | "+Infinity" | "NaN" | "-NaN" | "+NaN" | "undefined" => {
            out.push_str("null");
            true
        }
        _ => match normalize_number(tok) {
            Cow::Borrowed(s) => {
                out.push_str(s);
                false
            }
            Cow::Owned(s) => {
                out.push_str(&s);
                true
            }
        },
    }
}

fn normalize_number(tok: &str) -> Cow<'_, str> {
    let (neg, body) = if let Some(rest) = tok.strip_prefix('-') {
        (true, rest)
    } else if let Some(rest) = tok.strip_prefix('+') {
        (false, rest)
    } else {
        (false, tok)
    };

    if let Some(hex) = body
        .strip_prefix("0x")
        .or_else(|| body.strip_prefix("0X"))
        .filter(|h| !h.is_empty())
    {
        if let Ok(n) = u128::from_str_radix(hex, 16) {
            return Cow::Owned(if neg { format!("-{n}") } else { n.to_string() });
        }
    }

    let needs_lead = body.starts_with('.');
    let needs_tail = body.ends_with('.');
    if !needs_lead && !needs_tail && !tok.starts_with('+') {
        return Cow::Borrowed(tok);
    }
    let mut s = String::with_capacity(body.len() + 3);
    if neg {
        s.push('-');
    }
    if needs_lead {
        s.push('0');
    }
    s.push_str(body);
    if needs_tail {
        s.push('0');
    }
    Cow::Owned(s)
}

fn push_json_string(s: &str, out: &mut String) {
    match serde_json::to_string(s) {
        Ok(quoted) => out.push_str(&quoted),
        Err(_) => {
            out.push('"');
            out.push_str(s);
            out.push('"');
        }
    }
}

fn drop_trailing_comma(out: &mut String) -> bool {
    let end = out.trim_end().len();
    if out.as_bytes().get(end.wrapping_sub(1)) != Some(&b',') {
        return false;
    }
    out.remove(end - 1);
    true
}

fn copy_double_quoted(text: &str, start: usize, out: &mut String, changed: &mut bool) -> usize {
    let b = text.as_bytes();
    out.push('"');
    let mut i = start + 1;
    while i < b.len() {
        match b[i] {
            b'"' => {
                out.push('"');
                return i + 1;
            }
            b'\\' if i + 1 < b.len() => i = copy_escape(text, i, out, changed),
            _ => {
                let from = i;
                i += 1;
                while i < b.len() && b[i] != b'"' && b[i] != b'\\' {
                    i += 1;
                }
                out.push_str(&text[from..i]);
            }
        }
    }
    i // unterminated — the parser reports it against the rewritten text
}

fn copy_single_quoted(text: &str, start: usize, out: &mut String, changed: &mut bool) -> usize {
    let b = text.as_bytes();
    out.push('"');
    let mut i = start + 1;
    while i < b.len() {
        match b[i] {
            b'\'' => {
                out.push('"');
                return i + 1;
            }
            b'"' => {
                out.push_str("\\\"");
                i += 1;
            }
            b'\\' if i + 1 < b.len() => i = copy_escape(text, i, out, changed),
            _ => {
                let from = i;
                i += 1;
                while i < b.len() && !matches!(b[i], b'\'' | b'"' | b'\\') {
                    i += 1;
                }
                out.push_str(&text[from..i]);
            }
        }
    }
    i
}

fn copy_escape(text: &str, i: usize, out: &mut String, changed: &mut bool) -> usize {
    let b = text.as_bytes();
    match b[i + 1] {
        b'\n' => {
            *changed = true;
            i + 2
        }
        b'\r' => {
            *changed = true;
            if b.get(i + 2) == Some(&b'\n') {
                i + 3
            } else {
                i + 2
            }
        }
        b'\'' => {
            *changed = true;
            out.push('\'');
            i + 2
        }
        b'v' => {
            *changed = true;
            out.push_str("\\u000b");
            i + 2
        }
        b'0' if !b.get(i + 2).is_some_and(u8::is_ascii_digit) => {
            *changed = true;
            out.push_str("\\u0000");
            i + 2
        }
        b'x' if i + 3 < b.len() && b[i + 2].is_ascii_hexdigit() && b[i + 3].is_ascii_hexdigit() => {
            *changed = true;
            out.push_str("\\u00");
            out.push(b[i + 2] as char);
            out.push(b[i + 3] as char);
            i + 4
        }
        _ => {
            let mut end = i + 2;
            while end < text.len() && !text.is_char_boundary(end) {
                end += 1;
            }
            out.push_str(&text[i..end]);
            end
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovered(text: &str) -> String {
        recover(text, None).expect("recoverable").json
    }

    fn value(text: &str) -> serde_json::Value {
        serde_json::from_str(&recovered(text)).expect("recovers to valid JSON")
    }

    #[test]
    fn hint_reads_the_extension() {
        assert_eq!(hint_from_path("/a/b/log.ndjson"), Some(InputFormat::Ndjson));
        assert_eq!(hint_from_path("log.JSONL"), Some(InputFormat::Ndjson));
        assert_eq!(hint_from_path("tsconfig.jsonc"), Some(InputFormat::Relaxed));
        assert_eq!(hint_from_path("c.json5"), Some(InputFormat::Relaxed));
        assert_eq!(hint_from_path("d.json"), None);
        assert_eq!(hint_from_path("d.geojson"), None);
        assert_eq!(hint_from_path("README.md"), None);
        assert_eq!(hint_from_path("Makefile"), None);
    }

    #[test]
    fn quote_wrappers_are_unwrapped_not_read_as_strings() {
        let body = r#"{"orderId":917399,"shortSideTt":1.25}"#;
        let want = serde_json::json!({"orderId": 917399, "shortSideTt": 1.25});
        for (name, text) in [
            ("both single", format!("'{body}'")),
            ("leading single only", format!("'{body}")),
            ("trailing single only", format!("{body}'")),
            ("both backticks", format!("`{body}`")),
            ("smart quotes", format!("\u{2018}{body}\u{2019}")),
            ("surrounded by whitespace", format!("  '{body}'  ")),
        ] {
            let r = recover(&text, None).unwrap_or_else(|| panic!("{name} should recover"));
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&r.json).unwrap(),
                want,
                "{name}"
            );
            assert!(r.note.is_some(), "{name} should carry a note");
        }
    }

    #[test]
    fn double_quoted_wrapper_unescapes_its_payload() {
        let r = recover(r#""{\"a\":1,\"b\":[2,3]}""#, None).expect("recovers");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&r.json).unwrap(),
            serde_json::json!({"a": 1, "b": [2, 3]})
        );
    }

    #[test]
    fn quoted_ndjson_recovers_through_both_passes() {
        let r = recover("'{\"a\":1}\n{\"a\":2}'", None).expect("recovers");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&r.json).unwrap(),
            serde_json::json!([{"a": 1}, {"a": 2}])
        );
    }

    #[test]
    fn leading_invisible_characters_are_stripped() {
        for ch in [
            '\u{feff}', '\u{200b}', '\u{2060}', '\u{200e}', '\u{a0}', '\u{0}',
        ] {
            let text = format!("{ch}{{\"a\":1}}");
            let r = recover(&text, None).unwrap_or_else(|| panic!("{ch:?} should recover"));
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&r.json).unwrap(),
                serde_json::json!({"a": 1}),
                "{ch:?}"
            );
            assert!(r.note.is_some(), "{ch:?} should carry a note");
        }
    }

    #[test]
    fn invisible_characters_inside_strings_are_left_alone() {
        let d: serde_json::Value =
            serde_json::from_str("{\"a\":\"x\u{200b}y\"}").expect("valid as-is");
        assert_eq!(d["a"].as_str().unwrap(), "x\u{200b}y");
    }

    #[test]
    fn lossless_dialect_recoveries_carry_no_note() {
        let ndjson = recover("{\"a\":1}\n{\"a\":2}\n", None).unwrap();
        assert_eq!(ndjson.note, None);
        assert!(!ndjson.comments_stripped);
        let relaxed = recover("{'a': 1,}", None).unwrap();
        assert_eq!(relaxed.note, None);
        assert!(!relaxed.comments_stripped);
    }

    #[test]
    fn comment_stripping_carries_a_note_and_flag() {
        let r = recover("{/* c */ \"a\": 1,}", None).unwrap();
        assert_eq!(r.note, Some(COMMENTS_STRIPPED_NOTE));
        assert!(r.comments_stripped);
    }

    #[test]
    fn comment_note_outranks_the_junk_strip_note() {
        let r = recover("\u{feff}{// c\n \"a\": 1}", None).unwrap();
        assert_eq!(r.note, Some(COMMENTS_STRIPPED_NOTE));
        assert!(r.comments_stripped);
    }

    #[test]
    fn ndjson_becomes_an_array() {
        let json = recovered("{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n");
        assert_eq!(json, r#"[{"a":1},{"a":2},{"a":3}]"#);
    }

    #[test]
    fn ndjson_tolerates_blank_lines_and_crlf() {
        let v = value("{\"a\":1}\r\n\r\n{\"a\":2}\r\n");
        assert_eq!(v, serde_json::json!([{"a": 1}, {"a": 2}]));
    }

    #[test]
    fn ndjson_ignores_newlines_inside_strings() {
        let v = value("{\"a\":\"x\\ny\"}\n{\"a\":\"}\"}\n");
        assert_eq!(v, serde_json::json!([{"a": "x\ny"}, {"a": "}"}]));
    }

    #[test]
    fn ndjson_accepts_pretty_printed_records() {
        let v = value("{\n  \"a\": 1\n}\n{\n  \"a\": 2\n}\n");
        assert_eq!(v, serde_json::json!([{"a": 1}, {"a": 2}]));
    }

    #[test]
    fn ndjson_accepts_bare_scalars_and_arrays() {
        let v = value("1\n\"two\"\ntrue\nnull\n[4]\n");
        assert_eq!(v, serde_json::json!([1, "two", true, null, [4]]));
    }

    #[test]
    fn ndjson_accepts_rfc7464_record_separators() {
        let v = value("\u{1e}{\"a\":1}\n\u{1e}{\"a\":2}\n");
        assert_eq!(v, serde_json::json!([{"a": 1}, {"a": 2}]));
    }

    #[test]
    fn ndjson_keeps_full_integer_precision() {
        let json = recovered("{\"id\":12345678901234567890}\n{\"id\":2}\n");
        assert!(json.contains("12345678901234567890"), "{json}");
    }

    #[test]
    fn line_comments_are_stripped() {
        let v = value("{\n  // who\n  \"a\": 1 // how many\n}");
        assert_eq!(v, serde_json::json!({"a": 1}));
    }

    #[test]
    fn block_comments_are_stripped() {
        let v = value("{/* lead */ \"a\": /* mid */ 1}");
        assert_eq!(v, serde_json::json!({"a": 1}));
    }

    #[test]
    fn comment_markers_inside_strings_survive() {
        let v = value("{\n  \"url\": \"https://x.dev/a\", // trailing\n}");
        assert_eq!(v, serde_json::json!({"url": "https://x.dev/a"}));
    }

    #[test]
    fn trailing_commas_are_dropped() {
        assert_eq!(value("{\"a\": 1,}"), serde_json::json!({"a": 1}));
        assert_eq!(value("[1, 2, 3,\n]"), serde_json::json!([1, 2, 3]));
    }

    #[test]
    fn json5_bare_keys_get_quoted() {
        let v = value("{a: 1, $b: 2, _c3: 3}");
        assert_eq!(v, serde_json::json!({"a": 1, "$b": 2, "_c3": 3}));
    }

    #[test]
    fn json5_single_quotes_become_double() {
        let v = value(r#"{'a': 'say "hi"', 'b': 'it\'s'}"#);
        assert_eq!(v, serde_json::json!({"a": "say \"hi\"", "b": "it's"}));
    }

    #[test]
    fn json5_numbers_are_rewritten() {
        let v = value("{a: 0xFF, b: .5, c: 5., d: +7, e: -0x10}");
        assert_eq!(
            v,
            serde_json::json!({"a": 255, "b": 0.5, "c": 5.0, "d": 7, "e": -16})
        );
    }

    #[test]
    fn json5_non_finite_numbers_become_null() {
        let v = value("{a: Infinity, b: -Infinity, c: NaN, d: undefined}");
        assert_eq!(
            v,
            serde_json::json!({"a": null, "b": null, "c": null, "d": null})
        );
    }

    #[test]
    fn json5_line_continuations_and_escapes() {
        let v = value("{a: 'one \\\ntwo', b: '\\x41', c: '\\0'}");
        assert_eq!(v, serde_json::json!({"a": "one two", "b": "A", "c": "\0"}));
    }

    #[test]
    fn relaxed_keeps_big_integers_verbatim() {
        let json = recovered("{id: 12345678901234567890, /* c */}");
        assert!(json.contains("12345678901234567890"), "{json}");
    }

    #[test]
    fn bom_only_failure_is_recovered_as_plain_json() {
        assert_eq!(recovered("\u{feff}{\"a\": 1}"), r#"{"a": 1}"#);
    }

    #[test]
    fn bom_plus_ndjson_is_recovered() {
        let v = value("\u{feff}{\"a\":1}\n{\"a\":2}\n");
        assert_eq!(v, serde_json::json!([{"a": 1}, {"a": 2}]));
    }

    #[test]
    fn commented_ndjson_needs_both_passes() {
        let r = recover("// log\n{\"a\":1}\n{\"a\":2}\n", None).expect("recovers");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&r.json).unwrap(),
            serde_json::json!([{"a": 1}, {"a": 2}])
        );
        assert!(r.comments_stripped, "flag survives the relaxed+ndjson pass");
    }

    #[test]
    fn genuinely_broken_json_is_not_recovered() {
        assert!(recover("{\"a\": }", None).is_none());
        assert!(recover("not json at all", None).is_none());
        assert!(recover("", None).is_none());
    }

    #[test]
    fn valid_json_needs_no_rewrite() {
        assert!(relaxed_to_json(r#"{"a": [1, 2], "b": "c"}"#).is_none());
        assert!(ndjson_to_array(r#"{"a": 1}"#).is_none());
    }

    #[test]
    fn multi_byte_content_survives_both_passes() {
        let v = value("{né: 'café ☕', /* ☕ */}");
        assert_eq!(v, serde_json::json!({"né": "café ☕"}));
    }

    #[test]
    fn unterminated_input_terminates_the_scan() {
        let _ = recover("{\"a\": \"unclosed", None);
        let _ = recover("{'a': 'unclosed", None);
        let _ = recover("{a: 1 /* unclosed", None);
        let _ = recover("[1, 2\\", None);
    }
}
