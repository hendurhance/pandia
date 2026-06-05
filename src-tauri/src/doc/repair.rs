
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
static ESCAPE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"[\\"\u{0000}-\u{001F}/]"#).unwrap()
});

static UNESCAPE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\\+)(.)").unwrap());

static IS_ESCAPED_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\\+["/nrtbf]"#).unwrap());

static QUOTE_RUN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\\+""#).unwrap());

fn common_replacements() -> &'static [(Regex, &'static str)] {
    static SET: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
        vec![
            (Regex::new(r",(\s*[}\]])").unwrap(), "$1"),
            (
                Regex::new(r"([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:").unwrap(),
                "$1\"$2\":",
            ),
            (Regex::new(r"'").unwrap(), "\""),
            (Regex::new(r"(?i):\s*undefined").unwrap(), ": null"),
            (Regex::new(r"(?i):\s*NaN").unwrap(), ": null"),
            (Regex::new(r"(?i):\s*Infinity").unwrap(), ": null"),
            (Regex::new(r"(?i):\s*-Infinity").unwrap(), ": null"),
            (Regex::new(r",,+").unwrap(), ","),
            (Regex::new(r"/\*[\s\S]*?\*/").unwrap(), ""),
            (Regex::new(r"(?m)//.*$").unwrap(), ""),
            (Regex::new(r#";(\s*["\w\[])"#).unwrap(), ",$1"),
        ]
    });
    &SET
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    pub success: bool,
    pub repaired_json: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub original_length: u32,
    pub repaired_length: u32,
    pub was_unescaped: bool,
    pub cleaned_up: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepUnescapeResult {
    pub result: String,
    pub iterations: u32,
    pub success: bool,
    pub error: Option<String>,
}

const FORMAT_THRESHOLD: usize = 500_000;
const SAMPLE_HEAD_TAIL: usize = 50_000;

#[allow(dead_code)]
pub fn escape(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    ESCAPE_RE
        .replace_all(text, |caps: &regex::Captures| {
            let ch = &caps[0];
            match ch {
                "\\" => "\\\\".to_string(),
                "\"" => "\\\"".to_string(),
                "\x08" => "\\b".to_string(),
                "\x0c" => "\\f".to_string(),
                "\n" => "\\n".to_string(),
                "\r" => "\\r".to_string(),
                "\t" => "\\t".to_string(),
                "/" => "/".to_string(),
                other => other.to_string(),
            }
        })
        .into_owned()
}

pub fn unescape(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    UNESCAPE_RE
        .replace_all(text, |caps: &regex::Captures| {
            let backslashes = &caps[1];
            let ch = &caps[2];
            let count = backslashes.len();
            let half = count / 2;
            let prefix: String = std::iter::repeat('\\').take(half).collect();

            let unescape_target = match ch {
                "b" => Some('\u{0008}'),
                "f" => Some('\u{000c}'),
                "n" => Some('\n'),
                "r" => Some('\r'),
                "t" => Some('\t'),
                "\"" => Some('"'),
                "\\" => Some('\\'),
                _ => None,
            };

            if count % 2 == 1 {
                if let Some(target) = unescape_target {
                    return format!("{}{}", prefix, target);
                }
            }
            let extra = if count % 2 == 1 { "\\" } else { "" };
            format!("{}{}{}", prefix, extra, ch)
        })
        .into_owned()
}

pub fn is_escaped(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    if text.len() > 100_000 {
        let head_end = nearest_boundary(text, SAMPLE_HEAD_TAIL, false);
        let tail_start = nearest_boundary(text, text.len().saturating_sub(SAMPLE_HEAD_TAIL), true);
        return IS_ESCAPED_RE.is_match(&text[..head_end])
            || IS_ESCAPED_RE.is_match(&text[tail_start..]);
    }
    IS_ESCAPED_RE.is_match(text)
}

pub fn get_escape_level(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    let sample = if text.len() > SAMPLE_HEAD_TAIL {
        let end = nearest_boundary(text, SAMPLE_HEAD_TAIL, false);
        &text[..end]
    } else {
        text
    };
    let matches: Vec<&str> = QUOTE_RUN_RE
        .find_iter(sample)
        .map(|m| m.as_str())
        .take(10)
        .collect();
    if matches.is_empty() {
        return 0;
    }
    let escape_lengths: Vec<usize> = matches.iter().map(|m| m.len() - 1).collect();
    let max_len = *escape_lengths.iter().max().unwrap_or(&0);
    (max_len / 2 + max_len % 2) as u32
}

pub fn deep_unescape(text: &str, max_iterations: u32) -> DeepUnescapeResult {
    if text.is_empty() {
        return DeepUnescapeResult {
            result: String::new(),
            iterations: 0,
            success: false,
            error: Some("Empty input".to_string()),
        };
    }
    let mut current = text.to_string();
    let mut iterations: u32 = 0;
    while iterations < max_iterations {
        if serde_json::from_str::<serde_json::Value>(&current).is_ok() {
            return DeepUnescapeResult {
                result: current,
                iterations,
                success: true,
                error: None,
            };
        }
        if !is_escaped(&current) {
            break;
        }
        let unescaped = unescape(&current);
        if unescaped == current || unescaped.len() == current.len() {
            break;
        }
        current = unescaped;
        iterations += 1;
        if current.len() > 1_000_000 && iterations > 2 {
            break;
        }
    }
    match serde_json::from_str::<serde_json::Value>(&current) {
        Ok(_) => DeepUnescapeResult {
            result: current,
            iterations,
            success: true,
            error: None,
        },
        Err(e) => DeepUnescapeResult {
            result: current,
            iterations,
            success: false,
            error: Some(format!(
                "Parse failed after {} iterations: {}",
                iterations, e
            )),
        },
    }
}

pub fn repair(input: &str) -> RepairResult {
    let original_length = input.len() as u32;
    let mut warnings: Vec<String> = Vec::new();
    let errors: Vec<String> = Vec::new();

    if input.is_empty() {
        return RepairResult {
            success: false,
            repaired_json: input.to_string(),
            errors: vec!["Input is not a valid string".to_string()],
            warnings,
            original_length,
            repaired_length: 0,
            was_unescaped: false,
            cleaned_up: false,
        };
    }

    let trimmed = input.trim().to_string();
    let original_json = trimmed.clone();

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&trimmed) {
        let formatted = format_value(&parsed, trimmed.len());
        let len = formatted.len() as u32;
        return RepairResult {
            success: true,
            repaired_json: formatted,
            errors,
            warnings,
            original_length,
            repaired_length: len,
            was_unescaped: false,
            cleaned_up: false,
        };
    } else if let Err(e) = serde_json::from_str::<serde_json::Value>(&trimmed) {
        warnings.push(format!("Initial parse failed: {}", e));
    }

    let mut current = trimmed.clone();
    let mut was_unescaped = false;
    if is_escaped(&current) {
        let level = get_escape_level(&current);
        let r = deep_unescape(&current, 5);
        if let Some(err) = &r.error {
            warnings.push(format!("Unescape warning: {}", err));
        }
        if r.success {
            let parsed: serde_json::Value =
                serde_json::from_str(&r.result).expect("deep_unescape claimed success");
            let formatted = format_value(&parsed, r.result.len());
            let len = formatted.len() as u32;
            warnings.push(format!(
                "Applied {} levels of unescaping (detected escape level: {})",
                r.iterations, level
            ));
            return RepairResult {
                success: true,
                repaired_json: formatted,
                errors,
                warnings,
                original_length,
                repaired_length: len,
                was_unescaped: true,
                cleaned_up: false,
            };
        } else if r.iterations > 0 {
            current = r.result;
            was_unescaped = true;
            warnings.push(format!(
                "Applied {} levels of unescaping (partial fix, detected escape level: {})",
                r.iterations, level
            ));
        }
    }

    let cleaned = basic_cleanup(&current, &mut warnings);
    let was_cleaned_up = cleaned != current;
    if was_cleaned_up {
        current = cleaned;
    }

    current = apply_common_fixes(&current, &mut warnings);
    current = advanced_repairs(&current, &mut warnings);

    match serde_json::from_str::<serde_json::Value>(&current) {
        Ok(parsed) => {
            let formatted = format_value(&parsed, current.len());
            if formatted != original_json {
                warnings.push("JSON was modified during repair".to_string());
            }
            let len = formatted.len() as u32;
            RepairResult {
                success: true,
                repaired_json: formatted,
                errors,
                warnings,
                original_length,
                repaired_length: len,
                was_unescaped,
                cleaned_up: was_cleaned_up,
            }
        }
        Err(e) => {
            let mut errs = errors.clone();
            errs.push(format!("Final parse failed: {}", e));
            RepairResult {
                success: false,
                repaired_json: original_json,
                errors: errs,
                warnings,
                original_length,
                repaired_length: 0,
                was_unescaped,
                cleaned_up: was_cleaned_up,
            }
        }
    }
}

fn format_value(v: &serde_json::Value, current_len: usize) -> String {
    if current_len > FORMAT_THRESHOLD {
        serde_json::to_string(v).unwrap_or_else(|_| String::new())
    } else {
        serde_json::to_string_pretty(v).unwrap_or_else(|_| String::new())
    }
}

fn basic_cleanup(json: &str, warnings: &mut Vec<String>) -> String {
    let mut s = json.to_string();

    if s.starts_with('\u{feff}') {
        s = s.trim_start_matches('\u{feff}').to_string();
        warnings.push("Removed BOM (Byte Order Mark)".to_string());
    }

    s = s.replace("\r\n", "\n").replace('\r', "\n");

    s = s.trim().to_string();

    if s.starts_with('(') && s.ends_with(')') && s.len() >= 2 {
        s = s[1..s.len() - 1].trim().to_string();
        warnings.push("Removed parentheses wrapper".to_string());
    }

    static JSONP_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"^\w+\s*\(\s*([\s\S]*?)\s*\)$"#).unwrap());
    if let Some(caps) = JSONP_RE.captures(&s) {
        if let Some(m) = caps.get(1) {
            s = m.as_str().trim().to_string();
            warnings.push("Removed JSONP callback wrapper".to_string());
        }
    }

    s
}

fn apply_common_fixes(json: &str, warnings: &mut Vec<String>) -> String {
    let mut current = json.to_string();
    for (re, replacement) in common_replacements() {
        let next = re.replace_all(&current, *replacement).into_owned();
        if next != current {
            warnings.push(format!("Applied fix: {}", re.as_str()));
            current = next;
        }
    }
    current
}

fn advanced_repairs(json: &str, warnings: &mut Vec<String>) -> String {
    let mut current = fix_bracket_mismatches(json, warnings);
    current = fix_unquoted_keys(&current, warnings);
    current = fix_string_escaping(&current, warnings);
    current = fix_javascript_literals(&current);
    current
}

fn fix_bracket_mismatches(json: &str, warnings: &mut Vec<String>) -> String {
    let bytes: Vec<char> = json.chars().collect();
    let mut stack: Vec<char> = Vec::new();
    let mut out = String::with_capacity(json.len());
    let mut i = 0;
    let mut unterminated_string = false;
    while i < bytes.len() {
        let c = bytes[i];
        if c == '"' {
            out.push(c);
            i += 1;
            let mut closed = false;
            while i < bytes.len() {
                if bytes[i] == '"' {
                    closed = true;
                    break;
                }
                if bytes[i] == '\\' {
                    out.push(bytes[i]);
                    if i + 1 < bytes.len() {
                        out.push(bytes[i + 1]);
                        i += 2;
                    } else {
                        i += 1;
                    }
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            if closed {
                out.push(bytes[i]);
            } else {
                unterminated_string = true;
            }
        } else if c == '{' || c == '[' {
            stack.push(c);
            out.push(c);
        } else if c == '}' || c == ']' {
            let expected = if c == '}' { '{' } else { '[' };
            match stack.pop() {
                Some(last) if last == expected => out.push(c),
                Some(last) => {
                    let correct = if last == '{' { '}' } else { ']' };
                    out.push(correct);
                    warnings.push(format!(
                        "Fixed bracket mismatch: expected '{}' but found '{}'",
                        correct, c
                    ));
                }
                None => {
                    warnings.push(format!("Removed extra closing bracket '{}'", c));
                }
            }
        } else {
            out.push(c);
        }
        i += 1;
    }
    if unterminated_string {
        out.push('"');
        warnings.push("Closed unterminated string at EOF".to_string());
    }
    while let Some(b) = stack.pop() {
        let closing = if b == '{' { '}' } else { ']' };
        out.push(closing);
        warnings.push(format!("Added missing closing bracket '{}'", closing));
    }
    out
}

fn fix_unquoted_keys(json: &str, warnings: &mut Vec<String>) -> String {
    static KEY_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:").unwrap());
    let mut fixed = json.to_string();
    let mut subs: Vec<(String, String, String)> = Vec::new();
    for caps in KEY_RE.captures_iter(&fixed) {
        let full = caps
            .get(0)
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        let prefix = caps
            .get(1)
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        let key = caps
            .get(2)
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        if !is_quoted(&key) && should_be_quoted(&key) {
            let replacement = format!("{}\"{}\":", prefix, key);
            subs.push((full, replacement, key));
        }
    }
    for (full, replacement, key) in subs {
        if let Some(idx) = fixed.find(&full) {
            fixed.replace_range(idx..idx + full.len(), &replacement);
            warnings.push(format!("Added quotes around key: {}", key));
        }
    }
    fixed
}

fn fix_string_escaping(json: &str, warnings: &mut Vec<String>) -> String {
    let mut fixed = json.to_string();
    static BAD_BACKSLASH_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r#"\\(?:[^"\\/bfnrtu]|u(?:[^0-9a-fA-F]|[0-9a-fA-F]{0,3}(?:[^0-9a-fA-F]|$)))"#)
            .unwrap()
    });
    let before = fixed.clone();
    fixed = BAD_BACKSLASH_RE
        .replace_all(&fixed, |caps: &regex::Captures| {
            let m = &caps[0];
            let rest = &m[1..];
            format!("\\\\{}", rest)
        })
        .into_owned();
    if fixed != before {
        warnings.push("Fixed string escaping issues".to_string());
    }

    let before = fixed.clone();
    let mut next = String::with_capacity(fixed.len());
    for c in fixed.chars() {
        let code = c as u32;
        if code < 0x20 && code != 0x09 && code != 0x0a && code != 0x0d {
            let escaped = match code {
                8 => "\\b".to_string(),
                12 => "\\f".to_string(),
                _ => format!("\\u{:04x}", code),
            };
            next.push_str(&escaped);
        } else {
            next.push(c);
        }
    }
    if next != before {
        warnings.push("Fixed string escaping issues".to_string());
    }
    next
}

fn fix_javascript_literals(json: &str) -> String {
    static JS_OBJ_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\w+)\s*:\s*([^,}\]]+)").unwrap());
    JS_OBJ_RE
        .replace_all(json, |caps: &regex::Captures| {
            let key = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let value = caps.get(2).map(|m| m.as_str()).unwrap_or("").trim();
            let quoted_key = if is_quoted(key) {
                key.to_string()
            } else {
                format!("\"{}\"", key)
            };
            let processed = if !is_quoted(value)
                && !is_number_str(value)
                && !is_boolean_str(value)
                && value != "null"
            {
                format!("\"{}\"", value)
            } else {
                value.to_string()
            };
            format!("{}: {}", quoted_key, processed)
        })
        .into_owned()
}

fn is_quoted(s: &str) -> bool {
    let s = s.trim();
    (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\''))
}

fn should_be_quoted(key: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "abstract",
        "arguments",
        "await",
        "boolean",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "double",
        "else",
        "enum",
        "eval",
        "export",
        "extends",
        "false",
        "final",
        "finally",
        "float",
        "for",
        "function",
        "goto",
        "if",
        "implements",
        "import",
        "in",
        "instanceof",
        "int",
        "interface",
        "let",
        "long",
        "native",
        "new",
        "null",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "short",
        "static",
        "super",
        "switch",
        "synchronized",
        "this",
        "throw",
        "throws",
        "transient",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "volatile",
        "while",
        "with",
        "yield",
    ];
    let lower = key.to_lowercase();
    if KEYWORDS.contains(&lower.as_str()) {
        return true;
    }
    static IDENT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z_$][a-zA-Z0-9_$]*$").unwrap());
    !IDENT_RE.is_match(key)
}

fn is_number_str(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    s.parse::<f64>().is_ok()
}

fn is_boolean_str(s: &str) -> bool {
    s == "true" || s == "false"
}

fn nearest_boundary(s: &str, idx: usize, walking_back: bool) -> usize {
    let mut i = idx.min(s.len());
    if walking_back {
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
    } else {
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn already_valid_json_passes_through() {
        let r = repair(r#"{"a": 1}"#);
        assert!(r.success);
        assert!(r.warnings.is_empty());
        assert!(!r.was_unescaped);
        assert!(!r.cleaned_up);
    }

    #[test]
    fn trailing_comma_in_object() {
        let r = repair(r#"{"a": 1,}"#);
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn trailing_comma_in_array() {
        let r = repair(r#"[1, 2, 3,]"#);
        assert!(r.success);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 3);
    }

    #[test]
    fn single_quotes_converted_to_double() {
        let r = repair("{'a': 'hello'}");
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"], "hello");
    }

    #[test]
    fn unquoted_keys_get_quoted() {
        let r = repair("{a: 1, b: 2}");
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], 2);
    }

    #[test]
    fn comments_removed() {
        let r = repair(
            r#"{"a": 1 , "b": 2 // line
}"#,
        );
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], 2);
    }

    #[test]
    fn undefined_nan_infinity_become_null() {
        let r = repair(r#"{"a": undefined, "b": NaN, "c": Infinity}"#);
        assert!(r.success);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert!(v["a"].is_null());
        assert!(v["b"].is_null());
        assert!(v["c"].is_null());
    }

    #[test]
    fn missing_closing_bracket() {
        let r = repair(r#"{"a": [1, 2"#);
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn mismatched_closing_bracket() {
        let r = repair(r#"{"a": [1, 2}"#);
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn jsonp_callback_unwrapped() {
        let r = repair("callback({\"a\": 1})");
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn bom_stripped() {
        let s = format!("\u{feff}{}", r#"{"a": 1}"#);
        let r = repair(&s);
        assert!(r.success);
        assert!(r.warnings.iter().any(|w| w.contains("BOM")));
    }

    #[test]
    fn escape_and_unescape_roundtrip() {
        let raw = "He said \"hi\"\nand left";
        let escaped = escape(raw);
        assert_eq!(escaped, "He said \\\"hi\\\"\\nand left");
        let back = unescape(&escaped);
        assert_eq!(back, raw);
    }

    #[test]
    fn deep_unescape_recovers_double_escaped_json() {
        let input = r#"{\"a\": 1}"#;
        let r = deep_unescape(input, 5);
        assert!(r.success, "error: {:?}", r.error);
        let v: serde_json::Value = serde_json::from_str(&r.result).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn deep_unescape_handles_triple_escape() {
        let once = r#"{\"a\": 1}"#;
        let twice = unescape(once); // unescape goes the OTHER direction; build via escape
        let valid = r#"{"a":1}"#;
        let step1 = escape(valid); // `{\"a\":1}`
        let step2 = escape(&step1); // `{\\\"a\\\":1}`
        let r = deep_unescape(&step2, 5);
        assert!(r.success, "result: {} error: {:?}", r.result, r.error);
        let _ = twice; // suppress unused; the explicit chain above is what we assert against
    }

    #[test]
    fn empty_input_reports_error() {
        let r = repair("");
        assert!(!r.success);
        assert_eq!(r.errors.len(), 1);
    }

    #[test]
    fn unterminated_string_at_eof_in_array() {
        let r = repair(r#"[{"id": "abc"},{"id": "CPHR246457BD0"#);
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        let arr = v.as_array().expect("root must be array");
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[1]["id"], "CPHR246457BD0");
        assert!(r.warnings.iter().any(|w| w.contains("unterminated string")));
    }

    #[test]
    fn unterminated_string_in_simple_object() {
        let r = repair(r#"{"key": "value"#);
        assert!(r.success, "warnings: {:?}", r.warnings);
        let v: serde_json::Value = serde_json::from_str(&r.repaired_json).unwrap();
        assert_eq!(v["key"], "value");
    }

    #[test]
    fn unrecoverable_garbage_reports_failure() {
        let r = repair("@@@@##!!@@");
        assert!(!r.success, "should fail: {:?}", r.repaired_json);
        assert!(!r.errors.is_empty());
    }
}
