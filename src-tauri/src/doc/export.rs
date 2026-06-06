use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt::Write as _;
use std::io::{self, Write};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportFormat {
    Json,
    JsonMin,
    Yaml,
    Csv,
    Xml,
}

#[derive(Debug, Clone, Serialize)]
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
            let json =
                serde_json::to_string(value).map_err(|e| ExportError::Serialize(e.to_string()))?;
            let yaml_val: serde_yaml_ng::Value = serde_yaml_ng::from_str(&json)
                .map_err(|e| ExportError::Serialize(e.to_string()))?;
            serde_yaml_ng::to_string(&yaml_val).map_err(|e| ExportError::Serialize(e.to_string()))
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
    r.map_err(|e| ExportError::Serialize(e.to_string()))
}

pub fn write_json_source<W: Write>(
    source: &str,
    pretty: bool,
    writer: W,
) -> Result<(), ExportError> {
    let mut de = serde_json::Deserializer::from_str(source);
    let r = if pretty {
        let mut ser = serde_json::Serializer::pretty(writer);
        serde_transcode::transcode(&mut de, &mut ser).map(|_| ())
    } else {
        let mut ser = serde_json::Serializer::new(writer);
        serde_transcode::transcode(&mut de, &mut ser).map(|_| ())
    };
    r.map_err(|e| ExportError::Serialize(e.to_string()))
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
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn to_xml(value: &Value) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    write_xml_element(&mut out, "root", value, 0);
    out
}

fn write_xml_element(out: &mut String, tag: &str, value: &Value, depth: usize) {
    let indent = "  ".repeat(depth);
    match value {
        Value::Object(map) => {
            let _ = writeln!(out, "{}<{}>", indent, tag);
            for (k, v) in map {
                write_xml_element(out, &sanitize_tag(k), v, depth + 1);
            }
            let _ = writeln!(out, "{}</{}>", indent, tag);
        }
        Value::Array(items) => {
            for item in items {
                write_xml_element(out, tag, item, depth);
            }
        }
        Value::Null => {
            let _ = writeln!(out, "{}<{}/>", indent, tag);
        }
        Value::String(s) => {
            let _ = writeln!(out, "{}<{}>{}</{}>", indent, tag, escape_xml(s), tag);
        }
        Value::Bool(b) => {
            let _ = writeln!(out, "{}<{}>{}</{}>", indent, tag, b, tag);
        }
        Value::Number(n) => {
            let _ = writeln!(out, "{}<{}>{}</{}>", indent, tag, n, tag);
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
    if s.is_empty() || s.chars().next().unwrap().is_ascii_digit() {
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
        assert_eq!(xml.matches("<tags>").count(), 2);
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
