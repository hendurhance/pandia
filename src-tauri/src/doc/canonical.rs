use std::collections::{HashMap, HashSet};
use std::fmt::Write;

use serde_json::{Map, Value};

use super::types::{Path, PathSegment};

pub fn canonical_pretty(value: &Value) -> String {
    let mut sink = TextSink { out: String::new() };
    emit(value, 0, &mut sink);
    sink.out
}

pub fn canonical_offsets(value: &Value, wanted: &[Path]) -> Vec<Option<(u64, u64)>> {
    let mut sink = OffsetSink {
        pos: 0,
        stack: Vec::new(),
        wanted: wanted.iter().map(|p| p.0.as_slice()).collect(),
        found: HashMap::new(),
    };
    emit(value, 0, &mut sink);
    wanted
        .iter()
        .map(|p| sink.found.get(p.0.as_slice()).copied())
        .collect()
}

enum Seg<'a> {
    Key(&'a str),
    Index(u32),
}

trait Sink {
    fn write(&mut self, s: &str);
    fn begin_node(&mut self) -> u64 {
        0
    }
    fn end_node(&mut self, _start: u64) {}
    fn enter(&mut self, _seg: Seg<'_>) {}
    fn leave(&mut self) {}
}

struct TextSink {
    out: String,
}

impl Sink for TextSink {
    fn write(&mut self, s: &str) {
        self.out.push_str(s);
    }
}

struct OffsetSink<'a> {
    pos: u64,
    stack: Vec<PathSegment>,
    wanted: HashSet<&'a [PathSegment]>,
    found: HashMap<&'a [PathSegment], (u64, u64)>,
}

impl Sink for OffsetSink<'_> {
    fn write(&mut self, s: &str) {
        self.pos += if s.is_ascii() {
            s.len() as u64
        } else {
            s.encode_utf16().count() as u64
        };
    }
    fn begin_node(&mut self) -> u64 {
        self.pos
    }
    fn end_node(&mut self, start: u64) {
        if let Some(&path) = self.wanted.get(self.stack.as_slice()) {
            self.found.insert(path, (start, self.pos));
        }
    }
    fn enter(&mut self, seg: Seg<'_>) {
        self.stack.push(match seg {
            Seg::Key(k) => PathSegment::Key(k.to_owned()),
            Seg::Index(i) => PathSegment::Index(i),
        });
    }
    fn leave(&mut self) {
        self.stack.pop();
    }
}

fn pad<S: Sink>(depth: usize, out: &mut S) {
    for _ in 0..depth {
        out.write("  ");
    }
}

fn emit<S: Sink>(v: &Value, depth: usize, out: &mut S) {
    let start = out.begin_node();
    match v {
        Value::Null => out.write("null"),
        Value::Bool(b) => out.write(if *b { "true" } else { "false" }),
        Value::Number(n) => write_number(n, out),
        Value::String(s) => {
            out.write(&serde_json::to_string(s).expect("string serialization is infallible"))
        }
        Value::Array(items) => {
            if items.is_empty() {
                out.write("[]");
            } else {
                out.write("[\n");
                for (i, item) in items.iter().enumerate() {
                    pad(depth + 1, out);
                    out.enter(Seg::Index(i as u32));
                    emit(item, depth + 1, out);
                    out.leave();
                    if i + 1 < items.len() {
                        out.write(",");
                    }
                    out.write("\n");
                }
                pad(depth, out);
                out.write("]");
            }
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.write("{}");
            } else {
                let keys = js_key_order(map);
                out.write("{\n");
                for (i, key) in keys.iter().enumerate() {
                    pad(depth + 1, out);
                    out.write(
                        &serde_json::to_string(key).expect("string serialization is infallible"),
                    );
                    out.write(": ");
                    out.enter(Seg::Key(key));
                    emit(&map[key.as_str()], depth + 1, out);
                    out.leave();
                    if i + 1 < keys.len() {
                        out.write(",");
                    }
                    out.write("\n");
                }
                pad(depth, out);
                out.write("}");
            }
        }
    }
    out.end_node(start);
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

fn write_number<S: Sink>(n: &serde_json::Number, out: &mut S) {
    let token = n.to_string();
    if let Some(x) = n.as_f64() {
        let mut ecma = String::new();
        write_f64_ecma(x, &mut ecma);
        if ecma == token {
            out.write(&ecma);
            return;
        }
    }
    out.write(&token);
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
        out.push_str(digits);
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
        out.push_str(digits);
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
    fn matches_the_renderer_goldens() {
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

    fn p(segs: Vec<PathSegment>) -> Path {
        Path(segs)
    }
    fn k(s: &str) -> PathSegment {
        PathSegment::Key(s.into())
    }
    fn i(n: u32) -> PathSegment {
        PathSegment::Index(n)
    }

    #[test]
    fn offsets_slice_out_exactly_the_node_text() {
        let v: Value = serde_json::from_str(r#"{"a": 1, "b": [true, "hi"], "c": {"d": null}}"#)
            .expect("parses");
        let text = canonical_pretty(&v);
        let wanted = vec![
            p(vec![]),
            p(vec![k("a")]),
            p(vec![k("b")]),
            p(vec![k("b"), i(1)]),
            p(vec![k("c"), k("d")]),
            p(vec![k("nope")]),
        ];
        let offsets = canonical_offsets(&v, &wanted);
        let slice = |r: (u64, u64)| &text[r.0 as usize..r.1 as usize];
        assert_eq!(slice(offsets[0].unwrap()), text);
        assert_eq!(slice(offsets[1].unwrap()), "1");
        assert_eq!(slice(offsets[2].unwrap()), "[\n    true,\n    \"hi\"\n  ]");
        assert_eq!(slice(offsets[3].unwrap()), "\"hi\"");
        assert_eq!(slice(offsets[4].unwrap()), "null");
        assert_eq!(offsets[5], None);
    }

    #[test]
    fn offsets_count_utf16_units_not_bytes() {
        // '🦀' is 4 UTF-8 bytes but 2 UTF-16 units; CodeMirror addresses UTF-16.
        let v: Value = serde_json::from_str(r#"{"e": "🦀", "z": 7}"#).expect("parses");
        let text = canonical_pretty(&v);
        let wanted = vec![p(vec![k("z")])];
        let offsets = canonical_offsets(&v, &wanted);
        let (start, end) = offsets[0].unwrap();
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let sliced = String::from_utf16(&utf16[start as usize..end as usize]).unwrap();
        assert_eq!(sliced, "7");
    }

    #[test]
    fn offsets_keep_big_number_tokens_addressable() {
        let v: Value = serde_json::from_str(r#"{"id": 1075283027435454464}"#).expect("parses");
        let text = canonical_pretty(&v);
        let offsets = canonical_offsets(&v, &[p(vec![k("id")])]);
        let (start, end) = offsets[0].unwrap();
        assert_eq!(&text[start as usize..end as usize], "1075283027435454464");
    }
}
