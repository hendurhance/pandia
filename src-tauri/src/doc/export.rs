use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::Write as _;
use std::io::{self, Write};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExportFormat {
    Json,
    JsonMin,
    Yaml,
    Csv,
    Xml,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreview {
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("{0}")]
    Serialize(String),
    #[error("CSV export needs an array of objects ({0})")]
    CsvShape(String),
    #[error(transparent)]
    Io(io::Error),
}

fn json_error(e: serde_json::Error) -> ExportError {
    if e.is_io() {
        ExportError::Io(e.into())
    } else {
        ExportError::Serialize(e.to_string())
    }
}

pub fn export(value: &Value, format: ExportFormat) -> Result<String, ExportError> {
    match format {
        ExportFormat::Json => {
            serde_json::to_string_pretty(value).map_err(|e| ExportError::Serialize(e.to_string()))
        }
        ExportFormat::JsonMin => {
            serde_json::to_string(value).map_err(|e| ExportError::Serialize(e.to_string()))
        }
        ExportFormat::Yaml => {
            let mut out = String::new();
            write_yaml(&mut out, value, 0);
            Ok(out)
        }
        ExportFormat::Csv => to_csv(value),
        ExportFormat::Xml => Ok(to_xml(value)),
    }
}

pub fn write_json_value<W: Write>(
    value: &Value,
    pretty: bool,
    writer: W,
) -> Result<(), ExportError> {
    let r = if pretty {
        serde_json::to_writer_pretty(writer, value)
    } else {
        serde_json::to_writer(writer, value)
    };
    r.map_err(json_error)
}

pub fn write_json_source<W: Write>(
    source: &str,
    pretty: bool,
    writer: W,
) -> Result<(), ExportError> {
    let mut de = serde_json::Deserializer::from_str(source);

    de.disable_recursion_limit();
    let mut writer = KeepWriteError {
        inner: writer,
        error: None,
    };
    let r = if pretty {
        let mut ser = serde_json::Serializer::pretty(&mut writer);
        serde_transcode::transcode(&mut de, &mut ser).map(|_| ())
    } else {
        let mut ser = serde_json::Serializer::new(&mut writer);
        serde_transcode::transcode(&mut de, &mut ser).map(|_| ())
    };
    r.map_err(|e| writer.error.map_or_else(|| json_error(e), ExportError::Io))
}

// serde_transcode turns a write error into plain text, so the writer keeps the original.
struct KeepWriteError<W> {
    inner: W,
    error: Option<io::Error>,
}

impl<W> KeepWriteError<W> {
    fn keep<T>(&mut self, r: io::Result<T>) -> io::Result<T> {
        r.map_err(|e| {
            let kind = e.kind();
            self.error = Some(e);
            kind.into()
        })
    }
}

impl<W: Write> Write for KeepWriteError<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        let r = self.inner.write(data);
        self.keep(r)
    }
    fn flush(&mut self) -> io::Result<()> {
        let r = self.inner.flush();
        self.keep(r)
    }
}

struct CappedWriter {
    buf: Vec<u8>,
    cap: usize,
    overflowed: bool,
}

impl CappedWriter {
    fn new(cap: usize) -> Self {
        Self {
            buf: Vec::with_capacity(cap.min(1 << 16)),
            cap,
            overflowed: false,
        }
    }
    fn finish(self) -> (String, bool) {
        (
            String::from_utf8_lossy(&self.buf).into_owned(),
            self.overflowed,
        )
    }
}

impl Write for CappedWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if self.buf.len() + data.len() > self.cap {
            self.overflowed = true;
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "preview cap reached",
            ));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub fn preview_json_value(value: &Value, pretty: bool, max_bytes: usize) -> (String, bool) {
    let mut w = CappedWriter::new(max_bytes);
    let _ = write_json_value(value, pretty, &mut w);
    w.finish()
}

pub fn preview_json_source(
    source: &str,
    pretty: bool,
    max_bytes: usize,
) -> Result<(String, bool), ExportError> {
    let mut w = CappedWriter::new(max_bytes);
    match write_json_source(source, pretty, &mut w) {
        Ok(()) => Ok(w.finish()),
        Err(e) if w.overflowed => {
            let _ = e;
            Ok(w.finish())
        }
        Err(e) => Err(e),
    }
}

fn to_csv(value: &Value) -> Result<String, ExportError> {
    let arr = value
        .as_array()
        .ok_or_else(|| ExportError::CsvShape("root is not an array".into()))?;
    if arr.is_empty() {
        return Ok(String::new());
    }
    if !arr.iter().all(|v| v.is_object()) {
        return Err(ExportError::CsvShape(
            "not every element is an object".into(),
        ));
    }

    let mut columns: Vec<String> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for item in arr {
        if let Value::Object(map) = item {
            for k in map.keys() {
                if seen.insert(k.clone()) {
                    columns.push(k.clone());
                }
            }
        }
    }

    let mut wtr = csv::WriterBuilder::new().from_writer(Vec::new());
    wtr.write_record(&columns)
        .map_err(|e| ExportError::Serialize(e.to_string()))?;
    for item in arr {
        let obj = item.as_object().unwrap();
        let row: Vec<String> = columns
            .iter()
            .map(|c| obj.get(c).map(cell_to_string).unwrap_or_default())
            .collect();
        wtr.write_record(&row)
            .map_err(|e| ExportError::Serialize(e.to_string()))?;
    }
    let bytes = wtr
        .into_inner()
        .map_err(|e| ExportError::Serialize(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| ExportError::Serialize(e.to_string()))
}

fn cell_to_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        // Spreadsheets run text that starts like this as a formula (OWASP CSV injection).
        Value::String(s) if s.starts_with(['=', '+', '-', '@', '\t', '\r']) => format!("'{s}"),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn write_yaml(out: &mut String, value: &Value, indent: usize) {
    match value {
        Value::Object(map) if !map.is_empty() => {
            for (i, (k, v)) in map.iter().enumerate() {
                if i > 0 {
                    out.push_str(&" ".repeat(indent));
                }
                write_yaml_str(out, k);
                out.push(':');
                if yaml_is_block(v) {
                    out.push('\n');
                    out.push_str(&" ".repeat(indent + 2));
                } else {
                    out.push(' ');
                }
                write_yaml(out, v, indent + 2);
            }
        }
        Value::Array(items) if !items.is_empty() => {
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push_str(&" ".repeat(indent));
                }
                out.push_str("- ");
                write_yaml(out, item, indent + 2);
            }
        }
        Value::Object(_) => out.push_str("{}\n"),
        Value::Array(_) => out.push_str("[]\n"),
        Value::Null => out.push_str("null\n"),
        Value::Bool(b) => {
            let _ = writeln!(out, "{b}");
        }
        Value::Number(n) => {
            let _ = writeln!(out, "{}", yaml_number(&n.to_string()));
        }
        Value::String(s) => {
            write_yaml_str(out, s);
            out.push('\n');
        }
    }
}

fn yaml_is_block(value: &Value) -> bool {
    match value {
        Value::Object(map) => !map.is_empty(),
        Value::Array(items) => !items.is_empty(),
        _ => false,
    }
}

fn yaml_number(token: &str) -> String {
    let Some(at) = token.find(['e', 'E']) else {
        return token.to_string();
    };
    let (mantissa, exponent) = (&token[..at], &token[at + 1..]);
    let dot = if mantissa.contains('.') { "" } else { ".0" };
    let sign = if exponent.starts_with(['+', '-']) {
        ""
    } else {
        "+"
    };
    format!("{mantissa}{dot}e{sign}{exponent}")
}

fn write_yaml_str(out: &mut String, s: &str) {
    let plain = s.starts_with(char::is_alphabetic)
        && !s.ends_with(' ')
        && s.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.' | '/'))
        && !matches!(
            s.to_ascii_lowercase().as_str(),
            "y" | "n" | "yes" | "no" | "on" | "off" | "true" | "false" | "null"
        );
    if plain {
        out.push_str(s);
        return;
    }
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ' '..='~'
            | '\u{A0}'..='\u{2027}'
            | '\u{202A}'..='\u{D7FF}'
            | '\u{E000}'..='\u{FEFE}'
            | '\u{FF00}'..='\u{FFFD}'
            | '\u{10000}'..='\u{10FFFF}' => out.push(c),
            _ => {
                let _ = write!(out, "\\u{:04X}", c as u32);
            }
        }
    }
    out.push('"');
}

fn to_xml(value: &Value) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    write_xml_element(&mut out, "root", "", value, 0);
    out
}

fn write_xml_element(out: &mut String, tag: &str, attrs: &str, value: &Value, depth: usize) {
    let indent = "  ".repeat(depth);
    match value {
        Value::Object(map) if !map.is_empty() => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}>");
            for (k, v) in map {
                let name = sanitize_tag(k);
                let attrs = if name == *k {
                    String::new()
                } else {
                    format!(" name=\"{}\"", escape_xml(k))
                };
                write_xml_element(out, &name, &attrs, v, depth + 1);
            }
            let _ = writeln!(out, "{indent}</{tag}>");
        }
        Value::Array(items) if !items.is_empty() => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}>");
            for item in items {
                write_xml_element(out, "item", "", item, depth + 1);
            }
            let _ = writeln!(out, "{indent}</{tag}>");
        }
        Value::Null | Value::Object(_) | Value::Array(_) => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}/>");
        }
        Value::String(s) => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}>{}</{tag}>", escape_xml(s));
        }
        Value::Bool(b) => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}>{b}</{tag}>");
        }
        Value::Number(n) => {
            let _ = writeln!(out, "{indent}<{tag}{attrs}>{n}</{tag}>");
        }
    }
}

fn sanitize_tag(key: &str) -> String {
    let mut s: String = key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if !s.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') {
        s.insert(0, '_');
    }
    s
}

fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\u{0}'..='\u{8}'
            | '\u{B}'
            | '\u{C}'
            | '\u{E}'..='\u{1F}'
            | '\u{FFFE}'
            | '\u{FFFF}' => out.push('\u{FFFD}'),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_pretty_and_min() {
        let v = json!({"a": 1, "b": [2, 3]});
        let pretty = export(&v, ExportFormat::Json).unwrap();
        assert!(pretty.contains("\n"));
        let min = export(&v, ExportFormat::JsonMin).unwrap();
        assert!(!min.contains("\n"));
        assert_eq!(min, r#"{"a":1,"b":[2,3]}"#);
    }

    #[test]
    fn yaml_export() {
        let v = json!({"name": "Ada", "age": 36});
        let y = export(&v, ExportFormat::Yaml).unwrap();
        assert!(y.contains("name: Ada"));
        assert!(y.contains("age: 36"));
    }

    #[test]
    fn csv_array_of_objects() {
        let v = json!([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]);
        let csv = export(&v, ExportFormat::Csv).unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "id,name");
        assert_eq!(lines[1], "1,a");
        assert_eq!(lines[2], "2,b");
    }

    #[test]
    fn csv_sparse_keys_union() {
        let v = json!([{"a": 1}, {"b": 2}]);
        let csv = export(&v, ExportFormat::Csv).unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "a,b");
        assert_eq!(lines[1], "1,");
        assert_eq!(lines[2], ",2");
    }

    #[test]
    fn csv_text_a_spreadsheet_would_run_as_a_formula_gets_a_leading_quote() {
        let v = json!([
            {"v": "=SUM(A1:A2)"}, {"v": "+1"}, {"v": "-1"}, {"v": "@cmd"},
            {"v": "\tx"}, {"v": "\rx"}, {"v": "a=b"}, {"v": -5}, {"v": 2.5}
        ]);
        let out = export(&v, ExportFormat::Csv).unwrap();
        let cells: Vec<String> = csv::Reader::from_reader(out.as_bytes())
            .records()
            .map(|r| r.unwrap()[0].to_string())
            .collect();
        assert_eq!(
            cells,
            [
                "'=SUM(A1:A2)",
                "'+1",
                "'-1",
                "'@cmd",
                "'\tx",
                "'\rx",
                "a=b",
                "-5",
                "2.5"
            ]
        );
    }

    #[test]
    fn json_write_failures_keep_the_io_error() {
        struct DiskFull;
        impl Write for DiskFull {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::ErrorKind::StorageFull.into())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        for err in [
            write_json_value(&json!({"a": 1}), true, DiskFull).unwrap_err(),
            write_json_source(r#"{"a":1}"#, false, DiskFull).unwrap_err(),
        ] {
            assert!(
                matches!(&err, ExportError::Io(e) if e.kind() == io::ErrorKind::StorageFull),
                "{err:?}"
            );
        }
    }

    #[test]
    fn csv_rejects_non_array() {
        let v = json!({"a": 1});
        assert!(matches!(
            export(&v, ExportFormat::Csv),
            Err(ExportError::CsvShape(_))
        ));
    }

    #[test]
    fn xml_nested() {
        let v = json!({"user": {"name": "Ada", "tags": ["x", "y"]}});
        let xml = export(&v, ExportFormat::Xml).unwrap();
        assert!(xml.contains("<root>"));
        assert!(xml.contains("<user>"));
        assert!(xml.contains("<name>Ada</name>"));
        assert!(
            xml.contains("    <tags>\n      <item>x</item>\n      <item>y</item>\n    </tags>\n"),
            "{xml}"
        );
    }

    #[test]
    fn xml_root_array_is_one_root_with_item_children() {
        let xml = export(&json!([{"a": 1}, {"a": 2}]), ExportFormat::Xml).unwrap();
        assert_eq!(
            xml,
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<root>\n  <item>\n    <a>1</a>\n  </item>\n  <item>\n    <a>2</a>\n  </item>\n</root>\n"
        );
    }

    #[test]
    fn xml_nested_arrays_nest_items() {
        let xml = export(&json!([[1, 2], [3]]), ExportFormat::Xml).unwrap();
        assert!(
            xml.ends_with("<root>\n  <item>\n    <item>1</item>\n    <item>2</item>\n  </item>\n  <item>\n    <item>3</item>\n  </item>\n</root>\n"),
            "{xml}"
        );
    }

    #[test]
    fn xml_empty_containers_keep_their_key() {
        let xml = export(&json!({"tags": [], "meta": {}}), ExportFormat::Xml).unwrap();
        assert!(xml.contains("  <tags/>\n"), "{xml}");
        assert!(xml.contains("  <meta/>\n"), "{xml}");
    }

    #[test]
    fn xml_keys_that_are_not_names_keep_the_original_in_an_attribute() {
        let xml = export(&json!({"-x": 1, "a b": 2, "ok": 3}), ExportFormat::Xml).unwrap();
        assert!(xml.contains("<_-x name=\"-x\">1</_-x>"), "{xml}");
        assert!(xml.contains("<a_b name=\"a b\">2</a_b>"), "{xml}");
        assert!(xml.contains("<ok>3</ok>"), "{xml}");
    }

    #[test]
    fn xml_replaces_control_characters_xml_forbids() {
        let xml = export(&json!({"s": "a\u{1}b\tc"}), ExportFormat::Xml).unwrap();
        assert!(xml.contains("<s>a\u{FFFD}b\tc</s>"), "{xml}");
    }

    #[test]
    fn yaml_keeps_big_integers_and_long_decimals_verbatim() {
        let v: Value = serde_json::from_str(
            r#"{"wei":1000000000000000000000,"p":0.1000000000000000055511151231257827,"e":1e5}"#,
        )
        .unwrap();
        let y = export(&v, ExportFormat::Yaml).unwrap();
        assert_eq!(
            y,
            "wei: 1000000000000000000000\np: 0.1000000000000000055511151231257827\ne: 1.0e+5\n"
        );
    }

    #[test]
    fn yaml_quotes_strings_a_parser_would_read_as_something_else() {
        let v = json!({
            "a": "yes", "b": "No", "c": "null", "d": "1.0", "e": " lead", "f": "trail ",
            "g": "a: b", "h": "x #y", "i": "two\nlines", "j": "", "k": "~",
            "l": "plain text", "m": "\u{7f}\u{85}"
        });
        let y = export(&v, ExportFormat::Yaml).unwrap();
        for line in [
            "a: \"yes\"",
            "b: \"No\"",
            "c: \"null\"",
            "d: \"1.0\"",
            "e: \" lead\"",
            "f: \"trail \"",
            "g: \"a: b\"",
            "h: \"x #y\"",
            "i: \"two\\nlines\"",
            "j: \"\"",
            "k: \"~\"",
            "l: plain text",
            "m: \"\\u007F\\u0085\"",
        ] {
            assert!(y.lines().any(|l| l == line), "missing {line:?} in:\n{y}");
        }
        let back: Value = serde_yaml_ng::from_str(&y).unwrap();
        assert_eq!(back, v);
    }

    #[test]
    fn yaml_nested_layout_round_trips() {
        let v = json!({
            "list": [1, [2, 3], {"a": true, "b": []}, {}],
            "obj": {"inner": {"x": null}},
            "名前": "値"
        });
        let y = export(&v, ExportFormat::Yaml).unwrap();
        assert!(
            y.starts_with("list:\n  - 1\n  - - 2\n    - 3\n  - a: true\n    b: []\n  - {}\n"),
            "{y}"
        );
        let back: Value = serde_yaml_ng::from_str(&y).unwrap();
        assert_eq!(back, v, "{y}");
    }

    #[test]
    fn xml_escapes_special_chars() {
        let v = json!({"x": "a & b < c"});
        let xml = export(&v, ExportFormat::Xml).unwrap();
        assert!(xml.contains("a &amp; b &lt; c"));
    }

    #[test]
    fn write_json_value_matches_export() {
        let v = json!({"a": 1, "b": [2, 3]});
        let mut min = Vec::new();
        write_json_value(&v, false, &mut min).unwrap();
        assert_eq!(String::from_utf8(min).unwrap(), r#"{"a":1,"b":[2,3]}"#);
        let mut pretty = Vec::new();
        write_json_value(&v, true, &mut pretty).unwrap();
        assert!(String::from_utf8(pretty).unwrap().contains('\n'));
    }

    #[test]
    fn write_json_source_transcodes() {
        let src = "{\n  \"a\" : 1,\n  \"b\":[2,3]\n}";
        let mut min = Vec::new();
        write_json_source(src, false, &mut min).unwrap();
        assert_eq!(String::from_utf8(min).unwrap(), r#"{"a":1,"b":[2,3]}"#);
        let mut pretty = Vec::new();
        write_json_source(r#"{"a":1}"#, true, &mut pretty).unwrap();
        assert!(String::from_utf8(pretty).unwrap().contains('\n'));
    }

    #[test]
    fn write_json_source_preserves_big_int_token() {
        let src = r#"{"id":18446744073709551615}"#;
        let mut out = Vec::new();
        write_json_source(src, false, &mut out).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), src);
    }

    #[test]
    fn preview_truncates_at_cap() {
        let big = json!({ "items": vec![json!({"v": "xxxxxxxxxx"}); 500] });
        let (text, truncated) = preview_json_value(&big, true, 256);
        assert!(truncated);
        assert!(text.len() <= 256);
        assert!(text.starts_with('{'));
    }

    #[test]
    fn preview_not_truncated_when_small() {
        let v = json!({"a": 1});
        let (text, truncated) = preview_json_value(&v, false, 10_000);
        assert!(!truncated);
        assert_eq!(text, r#"{"a":1}"#);
        let (stext, strunc) = preview_json_source(r#"{"a":1}"#, false, 10_000).unwrap();
        assert!(!strunc);
        assert_eq!(stext, r#"{"a":1}"#);
    }
}
