
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectKind {
    Json,
    Yaml,
    Xml,
    Csv,
    Curl,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub kind: DetectKind,
    pub json: String,
    pub error: Option<String>,
}

pub fn detect_and_convert(text: &str) -> DetectResult {
    let trimmed = text.trim_start();
    if trimmed.is_empty() {
        return DetectResult {
            kind: DetectKind::Unknown,
            json: text.to_string(),
            error: Some("empty input".to_string()),
        };
    }

    let kind = guess(trimmed);
    match kind {
        DetectKind::Json => DetectResult {
            kind,
            json: text.to_string(),
            error: None,
        },
        DetectKind::Yaml => convert_yaml(text),
        DetectKind::Xml => convert_xml(text),
        DetectKind::Csv => convert_csv(text),
        DetectKind::Curl => convert_curl(text),
        DetectKind::Unknown => DetectResult {
            kind: DetectKind::Unknown,
            json: text.to_string(),
            error: Some("could not auto-detect format".to_string()),
        },
    }
}

fn guess(s: &str) -> DetectKind {
    let first = s.chars().next().unwrap_or(' ');
    if first == '{' || first == '[' {
        return DetectKind::Json;
    }
    if first == '<' {
        return DetectKind::Xml;
    }
    let lower = s.get(..16).unwrap_or(s).to_ascii_lowercase();
    if lower.starts_with("curl ") || lower.starts_with("curl\n") || lower.starts_with("curl\t") {
        return DetectKind::Curl;
    }
    if looks_like_csv(s) {
        return DetectKind::Csv;
    }
    if looks_like_yaml(s) {
        return DetectKind::Yaml;
    }
    DetectKind::Unknown
}

fn looks_like_csv(s: &str) -> bool {
    let mut lines = s.lines().filter(|l| !l.trim().is_empty());
    let Some(first) = lines.next() else {
        return false;
    };
    let Some(second) = lines.next() else {
        return false;
    };
    if !first.contains(',') || !second.contains(',') {
        return false;
    }
    let h = count_cells(first);
    let r = count_cells(second);
    h > 1 && (h == r || (h as i32 - r as i32).abs() <= 1)
}

fn count_cells(line: &str) -> usize {
    let mut count = 1;
    let mut in_quotes = false;
    for c in line.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
        } else if c == ',' && !in_quotes {
            count += 1;
        }
    }
    count
}

fn looks_like_yaml(s: &str) -> bool {
    if s.trim_start().starts_with("---") {
        return true;
    }
    for line in s.lines().take(40) {
        let t = line.trim_start();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if t.starts_with("- ") || t == "-" {
            return true;
        }
        if let Some(idx) = t.find(':') {
            let key = &t[..idx];
            let rest = &t[idx + 1..];
            let key_ok = !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
            let rest_ok = rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t');
            if key_ok && rest_ok {
                return true;
            }
        }
        return false;
    }
    false
}

fn convert_yaml(text: &str) -> DetectResult {
    match serde_yaml_ng::from_str::<serde_json::Value>(text) {
        Ok(v) => DetectResult {
            kind: DetectKind::Yaml,
            json: serde_json::to_string_pretty(&v).unwrap_or_default(),
            error: None,
        },
        Err(e) => DetectResult {
            kind: DetectKind::Yaml,
            json: text.to_string(),
            error: Some(format!("yaml parse failed: {}", e)),
        },
    }
}

fn convert_xml(text: &str) -> DetectResult {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    use serde_json::{Map, Value};

    let mut reader = Reader::from_str(text);
    let mut buf = Vec::new();

    let mut stack: Vec<(String, Map<String, Value>, String)> = Vec::new();
    let mut root_kv: Option<(String, Value)> = None;

    fn attach_child(parent: &mut Map<String, Value>, key: &str, child: Value) {
        if let Some(existing) = parent.remove(key) {
            let arr = match existing {
                Value::Array(mut a) => {
                    a.push(child);
                    a
                }
                other => vec![other, child],
            };
            parent.insert(key.to_string(), Value::Array(arr));
        } else {
            parent.insert(key.to_string(), child);
        }
    }

    fn into_value(props: Map<String, Value>, text: String) -> Value {
        let trimmed = text.trim().to_string();
        if props.is_empty() {
            if trimmed.is_empty() {
                Value::Null
            } else {
                Value::String(trimmed)
            }
        } else if !trimmed.is_empty() {
            let mut p = props;
            p.insert("#text".into(), Value::String(trimmed));
            Value::Object(p)
        } else {
            Value::Object(props)
        }
    }

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let mut attrs = Map::new();
                for attr in e.attributes().flatten() {
                    let k = format!("@{}", String::from_utf8_lossy(attr.key.as_ref()));
                    let v = attr
                        .unescape_value()
                        .map(|v| v.into_owned())
                        .unwrap_or_default();
                    attrs.insert(k, Value::String(v));
                }
                stack.push((name, attrs, String::new()));
            }
            Ok(Event::End(_)) => {
                let Some((name, props, text)) = stack.pop() else {
                    continue;
                };
                let value = into_value(props, text);
                if let Some(parent) = stack.last_mut() {
                    attach_child(&mut parent.1, &name, value);
                } else {
                    root_kv = Some((name, value));
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let mut attrs = Map::new();
                for attr in e.attributes().flatten() {
                    let k = format!("@{}", String::from_utf8_lossy(attr.key.as_ref()));
                    let v = attr
                        .unescape_value()
                        .map(|v| v.into_owned())
                        .unwrap_or_default();
                    attrs.insert(k, Value::String(v));
                }
                let value = into_value(attrs, String::new());
                if let Some(parent) = stack.last_mut() {
                    attach_child(&mut parent.1, &name, value);
                } else {
                    root_kv = Some((name, value));
                }
            }
            Ok(Event::Text(t)) => {
                let txt = t.unescape().map(|v| v.into_owned()).unwrap_or_default();
                if let Some(top) = stack.last_mut() {
                    top.2.push_str(&txt);
                }
            }
            Ok(Event::CData(c)) => {
                if let Some(top) = stack.last_mut() {
                    top.2.push_str(&String::from_utf8_lossy(c.as_ref()));
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => {
                return DetectResult {
                    kind: DetectKind::Xml,
                    json: text.to_string(),
                    error: Some(format!("xml parse failed: {}", e)),
                };
            }
        }
        buf.clear();
    }

    let json_value = match root_kv {
        Some((name, value)) => {
            let mut root = Map::new();
            root.insert(name, value);
            Value::Object(root)
        }
        None => {
            return DetectResult {
                kind: DetectKind::Xml,
                json: text.to_string(),
                error: Some("xml has no root element".to_string()),
            };
        }
    };
    DetectResult {
        kind: DetectKind::Xml,
        json: serde_json::to_string_pretty(&json_value).unwrap_or_default(),
        error: None,
    }
}

fn convert_csv(text: &str) -> DetectResult {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers = match rdr.headers() {
        Ok(h) => h.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        Err(e) => {
            return DetectResult {
                kind: DetectKind::Csv,
                json: text.to_string(),
                error: Some(format!("csv header parse failed: {}", e)),
            };
        }
    };

    let mut rows: Vec<serde_json::Value> = Vec::new();
    for rec in rdr.records() {
        let rec = match rec {
            Ok(r) => r,
            Err(e) => {
                return DetectResult {
                    kind: DetectKind::Csv,
                    json: text.to_string(),
                    error: Some(format!("csv row parse failed: {}", e)),
                };
            }
        };
        let mut obj = serde_json::Map::new();
        for (i, cell) in rec.iter().enumerate() {
            let key = headers
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("col_{}", i + 1));
            obj.insert(key, infer_cell(cell));
        }
        rows.push(serde_json::Value::Object(obj));
    }
    DetectResult {
        kind: DetectKind::Csv,
        json: serde_json::to_string_pretty(&serde_json::Value::Array(rows)).unwrap_or_default(),
        error: None,
    }
}

fn infer_cell(s: &str) -> serde_json::Value {
    let t = s.trim();
    if t.is_empty() {
        return serde_json::Value::Null;
    }
    if t.eq_ignore_ascii_case("true") {
        return serde_json::Value::Bool(true);
    }
    if t.eq_ignore_ascii_case("false") {
        return serde_json::Value::Bool(false);
    }
    if t.eq_ignore_ascii_case("null") {
        return serde_json::Value::Null;
    }
    if let Ok(n) = t.parse::<i64>() {
        return serde_json::json!(n);
    }
    if let Ok(n) = t.parse::<f64>() {
        if n.is_finite() {
            return serde_json::json!(n);
        }
    }
    serde_json::Value::String(s.to_string())
}

fn convert_curl(text: &str) -> DetectResult {
    let tokens = match tokenize_shell(text.trim()) {
        Ok(t) => t,
        Err(e) => {
            return DetectResult {
                kind: DetectKind::Curl,
                json: text.to_string(),
                error: Some(format!("curl tokenize failed: {}", e)),
            };
        }
    };

    let mut iter = tokens.into_iter();
    match iter.next() {
        Some(first) if first.eq_ignore_ascii_case("curl") => {}
        _ => {
            return DetectResult {
                kind: DetectKind::Curl,
                json: text.to_string(),
                error: Some("curl tokens must start with `curl`".to_string()),
            };
        }
    }

    let mut url: Option<String> = None;
    let mut method: Option<String> = None;
    let mut headers: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut body: Option<String> = None;

    while let Some(tok) = iter.next() {
        match tok.as_str() {
            "-X" | "--request" => {
                if let Some(v) = iter.next() {
                    method = Some(v);
                }
            }
            "-H" | "--header" => {
                if let Some(v) = iter.next() {
                    if let Some((k, val)) = v.split_once(':') {
                        headers.insert(
                            k.trim().to_string(),
                            serde_json::Value::String(val.trim().to_string()),
                        );
                    }
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" => {
                if let Some(v) = iter.next() {
                    body = Some(v);
                }
            }
            "--url" => {
                if let Some(v) = iter.next() {
                    url = Some(v);
                }
            }
            "-A" | "--user-agent" | "-e" | "--referer" | "-u" | "--user" | "-o" | "--output"
            | "--cookie" | "-b" | "--cookie-jar" | "-c" => {
                let _ = iter.next();
            }
            other if !other.starts_with('-') && url.is_none() => {
                url = Some(other.to_string());
            }
            _ => {}
        }
    }

    let final_method = method.unwrap_or_else(|| {
        if body.is_some() {
            "POST".to_string()
        } else {
            "GET".to_string()
        }
    });

    let body_value: serde_json::Value = match body {
        None => serde_json::Value::Null,
        Some(b) => serde_json::from_str(&b).unwrap_or(serde_json::Value::String(b)),
    };

    let mut obj = serde_json::Map::new();
    obj.insert(
        "url".into(),
        url.map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    );
    obj.insert("method".into(), serde_json::Value::String(final_method));
    obj.insert("headers".into(), serde_json::Value::Object(headers));
    obj.insert("body".into(), body_value);

    DetectResult {
        kind: DetectKind::Curl,
        json: serde_json::to_string_pretty(&serde_json::Value::Object(obj)).unwrap_or_default(),
        error: None,
    }
}

fn tokenize_shell(s: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = s.chars().peekable();
    let mut has_token = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' if !in_single => {
                if matches!(chars.peek(), Some('\n')) {
                    chars.next();
                    continue;
                }
                if let Some(&next) = chars.peek() {
                    chars.next();
                    buf.push(next);
                    has_token = true;
                }
            }
            '\'' if !in_double => {
                in_single = !in_single;
                has_token = true;
            }
            '"' if !in_single => {
                in_double = !in_double;
                has_token = true;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if has_token {
                    out.push(std::mem::take(&mut buf));
                    has_token = false;
                }
            }
            c => {
                buf.push(c);
                has_token = true;
            }
        }
    }
    if in_single || in_double {
        return Err("unterminated quote".to_string());
    }
    if has_token {
        out.push(buf);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn assert_json(s: &str) -> Value {
        serde_json::from_str(s).expect("expected valid JSON")
    }

    #[test]
    fn json_passes_through() {
        let r = detect_and_convert(r#"{"a": 1}"#);
        assert_eq!(r.kind, DetectKind::Json);
        assert!(r.error.is_none());
        assert_eq!(r.json, r#"{"a": 1}"#);
    }

    #[test]
    fn yaml_converts_to_json() {
        let r = detect_and_convert("name: Ada\nage: 36\n");
        assert_eq!(r.kind, DetectKind::Yaml);
        assert!(r.error.is_none());
        let v = assert_json(&r.json);
        assert_eq!(v["name"], "Ada");
        assert_eq!(v["age"], 36);
    }

    #[test]
    fn yaml_array() {
        let r = detect_and_convert("- one\n- two\n- three\n");
        assert_eq!(r.kind, DetectKind::Yaml);
        let v = assert_json(&r.json);
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0], "one");
    }

    #[test]
    fn xml_simple_element() {
        let r = detect_and_convert(r#"<user><name>Ada</name><age>36</age></user>"#);
        assert_eq!(r.kind, DetectKind::Xml);
        assert!(r.error.is_none(), "err: {:?}", r.error);
        let v = assert_json(&r.json);
        assert_eq!(v["user"]["name"], "Ada");
        assert_eq!(v["user"]["age"], "36");
    }

    #[test]
    fn xml_with_attributes() {
        let r = detect_and_convert(r#"<user id="42"><name>Ada</name></user>"#);
        let v = assert_json(&r.json);
        assert_eq!(v["user"]["@id"], "42");
        assert_eq!(v["user"]["name"], "Ada");
    }

    #[test]
    fn xml_repeated_children_become_array() {
        let r = detect_and_convert(r#"<root><item>a</item><item>b</item><item>c</item></root>"#);
        let v = assert_json(&r.json);
        let items = v["root"]["item"].as_array().unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0], "a");
        assert_eq!(items[2], "c");
    }

    #[test]
    fn csv_basic() {
        let r = detect_and_convert("name,age\nAda,36\nGrace,85\n");
        assert_eq!(r.kind, DetectKind::Csv);
        let v = assert_json(&r.json);
        let rows = v.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["name"], "Ada");
        assert_eq!(rows[0]["age"], 36);
        assert_eq!(rows[1]["name"], "Grace");
    }

    #[test]
    fn csv_type_inference() {
        let r = detect_and_convert("flag,count,ratio,note\ntrue,7,1.5,hello\nfalse,8,2.0,\n");
        let v = assert_json(&r.json);
        assert_eq!(v[0]["flag"], true);
        assert_eq!(v[0]["count"], 7);
        assert_eq!(v[0]["ratio"], 1.5);
        assert_eq!(v[0]["note"], "hello");
        assert_eq!(v[1]["flag"], false);
        assert!(v[1]["note"].is_null());
    }

    #[test]
    fn curl_get_simple() {
        let r = detect_and_convert("curl https://example.com/data.json");
        assert_eq!(r.kind, DetectKind::Curl);
        let v = assert_json(&r.json);
        assert_eq!(v["url"], "https://example.com/data.json");
        assert_eq!(v["method"], "GET");
        assert!(v["headers"].as_object().unwrap().is_empty());
    }

    #[test]
    fn curl_post_with_headers_and_body() {
        let r = detect_and_convert(
            r#"curl -X POST 'https://api.example.com/v1/users' -H 'Content-Type: application/json' -d '{"name":"Ada"}'"#,
        );
        let v = assert_json(&r.json);
        assert_eq!(v["url"], "https://api.example.com/v1/users");
        assert_eq!(v["method"], "POST");
        assert_eq!(v["headers"]["Content-Type"], "application/json");
        assert_eq!(v["body"]["name"], "Ada");
    }

    #[test]
    fn curl_with_line_continuations() {
        let raw = "curl 'https://example.com' \\\n  -H 'X-Foo: bar' \\\n  -X PUT";
        let r = detect_and_convert(raw);
        let v = assert_json(&r.json);
        assert_eq!(v["url"], "https://example.com");
        assert_eq!(v["method"], "PUT");
        assert_eq!(v["headers"]["X-Foo"], "bar");
    }

    #[test]
    fn empty_input_is_unknown() {
        let r = detect_and_convert("   \n  ");
        assert_eq!(r.kind, DetectKind::Unknown);
        assert!(r.error.is_some());
    }

    #[test]
    fn random_text_is_unknown_and_preserves_input() {
        let r = detect_and_convert("just some plain words here");
        assert_eq!(r.kind, DetectKind::Unknown);
        assert_eq!(r.json, "just some plain words here");
    }

    #[test]
    fn guess_xml_with_prolog() {
        let kind = guess(r#"<?xml version="1.0"?><root>x</root>"#);
        assert_eq!(kind, DetectKind::Xml);
    }

    #[test]
    fn yaml_with_document_marker() {
        let r = detect_and_convert("---\nkey: value\n");
        assert_eq!(r.kind, DetectKind::Yaml);
        let v = assert_json(&r.json);
        assert_eq!(v["key"], "value");
    }
}
