use std::fmt::Write;

use serde_json::{Map, Value};

pub fn canonical_pretty(value: &Value) -> String {
    let mut out = String::new();
    emit(value, 0, &mut out);
    out
}

fn pad(depth: usize, out: &mut String) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn emit(v: &Value, depth: usize, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => write_number(n, out),
        Value::String(s) => {
            out.push_str(&serde_json::to_string(s).expect("string serialization is infallible"))
        }
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                pad(depth + 1, out);
                emit(item, depth + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            pad(depth, out);
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            let keys = js_key_order(map);
            out.push_str("{\n");
            for (i, key) in keys.iter().enumerate() {
                pad(depth + 1, out);
                out.push_str(
                    &serde_json::to_string(key).expect("string serialization is infallible"),
                );
                out.push_str(": ");
                emit(&map[key.as_str()], depth + 1, out);
                if i + 1 < keys.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            pad(depth, out);
            out.push('}');
        }
    }
}

fn js_key_order(map: &Map<String, Value>) -> Vec<&String> {
    let mut index_keys: Vec<(u32, &String)> = Vec::new();
    let mut rest: Vec<&String> = Vec::new();
    for key in map.keys() {
        match array_index(key) {
            Some(i) => index_keys.push((i, key)),
            None => rest.push(key),
        }
    }
    index_keys.sort_by_key(|&(i, _)| i);
    index_keys.into_iter().map(|(_, k)| k).chain(rest).collect()
}

fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    if !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|&n| n != u32::MAX)
}

fn write_number(n: &serde_json::Number, out: &mut String) {
    let token = n.to_string();
    if let Some(x) = n.as_f64() {
        let start = out.len();
        write_f64_ecma(x, out);
        if out[start..] == token {
            return;
        }
        out.truncate(start);
    }
    out.push_str(&token);
}

fn write_f64_ecma(x: f64, out: &mut String) {
    if x == 0.0 {
        out.push('0');
        return;
    }
    if x < 0.0 {
        out.push('-');
        return write_f64_ecma(-x, out);
    }
    if x.is_infinite() {
        out.push_str("Infinity");
        return;
    }
    let mut buffer = ryu::Buffer::new();
    let s = buffer.format_finite(x);
    let (mantissa, e) = match s.split_once('e') {
        Some((m, e)) => (m, e.parse::<i64>().expect("ryu exponent is an integer")),
        None => (s, 0),
    };
    let (int_part, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let all = format!("{int_part}{frac}");
    let lz = all.bytes().take_while(|&b| b == b'0').count();
    let digits = all[lz..].trim_end_matches('0');
    let n = int_part.len() as i64 - lz as i64 + e;
    let k = digits.len() as i64;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let exp = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let _ = write!(out, "e{}{}", if exp >= 0 { '+' } else { '-' }, exp.abs());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        name: String,
        input: String,
        expected: String,
    }

    #[test]
    fn matches_the_js_renderer_goldens() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("canonical_cases.json")).expect("fixture parses");
        assert!(cases.len() >= 30, "fixture set went missing");
        for c in &cases {
            let v: Value = serde_json::from_str(&c.input)
                .unwrap_or_else(|e| panic!("case {} input parse: {e}", c.name));
            assert_eq!(canonical_pretty(&v), c.expected, "case {}", c.name);
        }
    }

    #[test]
    fn integer_negative_zero_sign_is_lost_at_parse_time_so_rust_emits_zero_where_js_keeps_the_token(
    ) {
        let int: Value = serde_json::from_str("-0").expect("parses");
        assert_eq!(canonical_pretty(&int), "0");
        let float: Value = serde_json::from_str("-0.0").expect("parses");
        assert_eq!(canonical_pretty(&float), "-0.0");
    }

    #[test]
    fn same_value_with_a_different_token_renders_differently() {
        for (a, b) in [
            ("1.5", "1.50"),
            ("1075283027435454464", "1075283027435454465"),
            ("1234567890123456789", "1234567890123456790"),
            ("10.0", "10.00"),
            ("1e999", "1e1000"),
        ] {
            let va: Value = serde_json::from_str(a).expect("parses");
            let vb: Value = serde_json::from_str(b).expect("parses");
            assert_ne!(canonical_pretty(&va), canonical_pretty(&vb), "{a} vs {b}");
        }
    }
}
