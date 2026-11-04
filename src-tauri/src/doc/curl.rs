use std::path::{Path as FsPath, PathBuf};
use std::time::Duration;

use serde::Serialize;

use tauri_plugin_http::reqwest;

use crate::doc::jobs::CancelFlag;
use crate::doc::types::{DocError, DocResult};

const TEMP_PREFIX: &str = "pandia-response-";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "reason", rename_all = "camelCase")]
pub enum Refusal {
    NoUrl,
    Insecure { option: String },
    ReadsFile { option: String },
    NoPassword,
    Unsupported { option: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(tag = "problem", rename_all = "camelCase")]
pub enum RequestProblem {
    Refused {
        refusal: Refusal,
    },
    BadUrl {
        url: String,
    },
    Unreachable {
        host: String,
    },
    TimedOut {
        host: String,
    },
    Tls {
        host: String,
    },
    Interrupted {
        host: String,
    },
    TooLarge {
        limit: u64,
    },
    NotData {
        #[serde(rename = "contentType")]
        content_type: String,
        status: u16,
    },
    Empty {
        status: u16,
    },
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CurlRequest {
    pub url: Option<String>,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub user: Option<(String, String)>,
    pub follow_redirects: bool,
    pub connect_timeout: Option<Duration>,
    pub max_time: Option<Duration>,
    pub refusal: Option<Refusal>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CurlPreview {
    pub method: String,
    pub url: Option<String>,
    pub header_names: Vec<String>,
    pub body_bytes: Option<u64>,
    pub sends_on_paste: bool,
    pub refusal: Option<Refusal>,
}

pub struct Sent {
    pub file: TempFile,
    pub status: u16,
    pub status_text: String,
    pub headers: serde_json::Map<String, serde_json::Value>,
}

pub struct TempFile(PathBuf);

impl TempFile {
    pub fn path(&self) -> &FsPath {
        &self.0
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 50;
const CANCEL_POLL: Duration = Duration::from_millis(50);

const VALUE_OPTIONS: &[&str] = &[
    "-X",
    "--request",
    "-H",
    "--header",
    "-d",
    "--data",
    "--data-ascii",
    "--data-binary",
    "--data-raw",
    "--json",
    "--url",
    "-u",
    "--user",
    "-A",
    "--user-agent",
    "-e",
    "--referer",
    "-b",
    "--cookie",
    "-c",
    "--cookie-jar",
    "-o",
    "--output",
    "-m",
    "--max-time",
    "--connect-timeout",
];

const OUTPUT_ONLY: &[&str] = &[
    "-s",
    "--silent",
    "-S",
    "--show-error",
    "-v",
    "--verbose",
    "-i",
    "--include",
    "-f",
    "--fail",
    "--fail-with-body",
    "-#",
    "--progress-bar",
    "-N",
    "--no-buffer",
    "--compressed",
    "-g",
    "--globoff",
    "-O",
    "--remote-name",
    "--http1.1",
    "--http2",
    "-c",
    "--cookie-jar",
    "-o",
    "--output",
];

pub fn parse(text: &str) -> Result<CurlRequest, String> {
    let tokens = tokenize_shell(text.trim()).map_err(|e| format!("curl tokenize failed: {e}"))?;
    let mut tokens = tokens.into_iter();
    if !tokens
        .next()
        .is_some_and(|first| first.eq_ignore_ascii_case("curl"))
    {
        return Err("curl tokens must start with `curl`".to_string());
    }

    let mut req = CurlRequest::default();
    let mut method = None;
    let mut data: Vec<String> = Vec::new();
    let mut json = false;
    let mut head = false;
    let mut bare: Vec<String> = Vec::new();

    while let Some(tok) = tokens.next() {
        if !tok.starts_with('-') || tok == "-" {
            bare.push(tok);
            continue;
        }
        for (name, inline) in split_options(&tok) {
            let value = if VALUE_OPTIONS.contains(&name.as_str()) {
                match inline.or_else(|| tokens.next()) {
                    Some(v) => v,
                    None => break,
                }
            } else {
                String::new()
            };
            match name.as_str() {
                "-X" | "--request" => method = Some(value),
                "-H" | "--header" => match value.split_once(':') {
                    _ if value.starts_with('@') => req.refuse(Refusal::ReadsFile { option: name }),
                    Some((k, v)) => req.headers.push((k.trim().into(), v.trim().into())),
                    None => req.refuse(Refusal::Unsupported { option: name }),
                },
                "-d" | "--data" | "--data-ascii" | "--data-binary" | "--json" => {
                    if value.starts_with('@') {
                        req.refuse(Refusal::ReadsFile {
                            option: name.clone(),
                        });
                    }
                    json |= name == "--json";
                    data.push(value);
                }
                "--data-raw" => data.push(value),
                "--url" => req.url = Some(value),
                "-u" | "--user" => match value.split_once(':') {
                    Some((u, p)) => req.user = Some((u.into(), p.into())),
                    None => req.refuse(Refusal::NoPassword),
                },
                "-A" | "--user-agent" => req.headers.push(("User-Agent".into(), value)),
                "-e" | "--referer" => req.headers.push(("Referer".into(), value)),
                "-b" | "--cookie" if value.contains('=') => {
                    req.headers.push(("Cookie".into(), value))
                }
                "-b" | "--cookie" => req.refuse(Refusal::ReadsFile { option: name }),
                "-m" | "--max-time" | "--connect-timeout" => {
                    match value
                        .parse::<f64>()
                        .ok()
                        .and_then(|s| Duration::try_from_secs_f64(s).ok())
                    {
                        Some(d) if name == "--connect-timeout" => req.connect_timeout = Some(d),
                        Some(d) => req.max_time = Some(d),
                        None => req.refuse(Refusal::Unsupported { option: name }),
                    }
                }
                "-L" | "--location" => req.follow_redirects = true,
                "-I" | "--head" => head = true,
                "-k" | "--insecure" => req.refuse(Refusal::Insecure { option: name }),
                other if OUTPUT_ONLY.contains(&other) => {}
                _ => req.refuse(Refusal::Unsupported { option: name }),
            }
        }
    }

    if !data.is_empty() {
        let (content_type, separator) = if json {
            ("application/json", "")
        } else {
            ("application/x-www-form-urlencoded", "&")
        };
        req.default_header("Content-Type", content_type);
        if json {
            req.default_header("Accept", "application/json");
        }
        req.body = Some(data.join(separator));
    }
    req.method = method.unwrap_or_else(|| {
        match (head, req.body.is_some()) {
            (true, _) => "HEAD",
            (false, true) => "POST",
            (false, false) => "GET",
        }
        .to_string()
    });
    req.url = req.url.take().or_else(|| {
        bare.iter()
            .find(|t| t.contains("://"))
            .or(bare.first())
            .cloned()
    });
    if req.url.is_none() {
        req.refuse(Refusal::NoUrl);
    }
    Ok(req)
}

fn split_options(tok: &str) -> Vec<(String, Option<String>)> {
    if let Some(long) = tok.strip_prefix("--") {
        return match long.split_once('=') {
            Some((name, value)) => vec![(format!("--{name}"), Some(value.to_string()))],
            None => vec![(tok.to_string(), None)],
        };
    }
    let mut out = Vec::new();
    let letters = &tok[1..];
    for (i, c) in letters.char_indices() {
        let name = format!("-{c}");
        if VALUE_OPTIONS.contains(&name.as_str()) {
            let rest = &letters[i + c.len_utf8()..];
            out.push((name, (!rest.is_empty()).then(|| rest.to_string())));
            break;
        }
        out.push((name, None));
    }
    out
}

impl CurlRequest {
    fn refuse(&mut self, refusal: Refusal) {
        self.refusal.get_or_insert(refusal);
    }

    fn sent_headers(&self) -> impl Iterator<Item = &(String, String)> {
        self.headers.iter().filter(|(_, v)| !v.is_empty())
    }

    fn default_header(&mut self, name: &str, value: &str) {
        if !self
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case(name))
        {
            self.headers.push((name.into(), value.into()));
        }
    }

    fn target(&self) -> Option<String> {
        let url = self.url.as_deref()?;
        Some(if url.contains("://") {
            url.to_string()
        } else {
            format!("http://{url}")
        })
    }

    pub fn describe(&self) -> serde_json::Value {
        use serde_json::Value;
        let headers: serde_json::Map<String, Value> = self
            .headers
            .iter()
            .map(|(k, v)| (k.clone(), Value::String(v.clone())))
            .collect();
        let body = match &self.body {
            None => Value::Null,
            Some(b) => serde_json::from_str(b).unwrap_or_else(|_| Value::String(b.clone())),
        };
        serde_json::json!({
            "url": self.url,
            "method": self.method,
            "headers": headers,
            "body": body,
        })
    }

    pub fn preview(&self) -> CurlPreview {
        let mut header_names: Vec<String> = Vec::new();
        for (name, _) in self.sent_headers() {
            if !header_names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
                header_names.push(name.clone());
            }
        }
        CurlPreview {
            method: self.method.clone(),
            url: self.url.clone(),
            header_names,
            body_bytes: self.body.as_ref().map(|b| b.len() as u64),
            sends_on_paste: self.refusal.is_none()
                && self.body.is_none()
                && matches!(self.method.as_str(), "GET" | "HEAD"),
            refusal: self.refusal.clone(),
        }
    }

    pub fn tab_name(&self) -> String {
        let Some(url) = self.target().and_then(|t| reqwest::Url::parse(&t).ok()) else {
            return "response.json".into();
        };
        let segments: Vec<&str> = url
            .path_segments()
            .map(|s| s.filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        let stem = match segments.as_slice() {
            [.., prev, last] if last.bytes().all(|b| b.is_ascii_digit()) => {
                format!("{prev}-{last}")
            }
            [.., last] => FsPath::new(last)
                .file_stem()
                .map_or_else(|| last.to_string(), |s| s.to_string_lossy().into_owned()),
            [] => url.host_str().unwrap_or("response").to_string(),
        };
        let safe: String = stem
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        format!("{safe}.json")
    }
}

fn refused(refusal: Refusal) -> DocError {
    DocError::Request(RequestProblem::Refused { refusal })
}

pub async fn send(req: &CurlRequest, cancel: &CancelFlag, limit: u64) -> DocResult<Sent> {
    use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE};
    use tokio::io::AsyncWriteExt;

    if let Some(refusal) = &req.refusal {
        return Err(refused(refusal.clone()));
    }
    let target = req.target().ok_or_else(|| refused(Refusal::NoUrl))?;
    let bad_url = || {
        DocError::Request(RequestProblem::BadUrl {
            url: target.clone(),
        })
    };
    let url = reqwest::Url::parse(&target).map_err(|_| bad_url())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(bad_url());
    }
    let host = match (url.host_str(), url.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_string(),
        (None, _) => return Err(bad_url()),
    };
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|_| {
        refused(Refusal::Unsupported {
            option: "-X".into(),
        })
    })?;

    let mut client = reqwest::Client::builder()
        .user_agent(concat!("Pandia/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(req.connect_timeout.unwrap_or(CONNECT_TIMEOUT))
        .read_timeout(READ_TIMEOUT)
        .redirect(if req.follow_redirects {
            reqwest::redirect::Policy::limited(MAX_REDIRECTS)
        } else {
            reqwest::redirect::Policy::none()
        });
    if let Some(max) = req.max_time {
        client = client.timeout(max);
    }
    let client = client
        .build()
        .map_err(|_| DocError::Request(RequestProblem::Unreachable { host: host.clone() }))?;

    let mut request = client.request(method, url);
    for (name, value) in req.sent_headers() {
        let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) else {
            return Err(refused(Refusal::Unsupported {
                option: "-H".into(),
            }));
        };
        request = request.header(name, value);
    }
    if let Some((user, password)) = &req.user {
        request = request.basic_auth(user, Some(password));
    }
    if let Some(body) = &req.body {
        request = request.body(body.clone());
    }

    let fail = |e: reqwest::Error| DocError::Request(classify(&e, host.clone()));
    let mut response = cancellable(request.send(), cancel).await?.map_err(fail)?;
    let status = response.status();
    if let Some(content_type) = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(media_type)
        .filter(|ct| !is_data(ct))
    {
        return Err(DocError::Request(RequestProblem::NotData {
            content_type,
            status: status.as_u16(),
        }));
    }
    let too_large = || DocError::Request(RequestProblem::TooLarge { limit });
    if response.content_length().is_some_and(|n| n > limit) {
        return Err(too_large());
    }
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| {
            let v = String::from_utf8_lossy(v.as_bytes()).into_owned();
            (k.to_string(), serde_json::Value::String(v))
        })
        .collect();

    let file = TempFile(std::env::temp_dir().join(format!(
        "{TEMP_PREFIX}{}.json",
        uuid::Uuid::new_v4().simple()
    )));
    let mut out = tokio::fs::File::from_std(crate::doc::atomic::create_private(file.path())?);
    let mut written = 0u64;
    while let Some(chunk) = cancellable(response.chunk(), cancel).await?.map_err(fail)? {
        written += chunk.len() as u64;
        if written > limit {
            return Err(too_large());
        }
        out.write_all(&chunk).await?;
    }
    out.flush().await?;

    Ok(Sent {
        file,
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
    })
}

pub fn media_type(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn is_data(content_type: &str) -> bool {
    const DATA: &[&str] = &[
        "json",
        "yaml",
        "yml",
        "xml",
        "csv",
        "javascript",
        "text/plain",
        "octet-stream",
    ];
    !content_type.contains("html") && DATA.iter().any(|d| content_type.contains(d))
}

fn classify(e: &reqwest::Error, host: String) -> RequestProblem {
    if e.is_timeout() {
        RequestProblem::TimedOut { host }
    } else if e.is_connect() && is_tls(e) {
        RequestProblem::Tls { host }
    } else if e.is_connect() {
        RequestProblem::Unreachable { host }
    } else {
        RequestProblem::Interrupted { host }
    }
}

fn is_tls(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut next = e.source();
    while let Some(err) = next {
        next = match err.downcast_ref::<std::io::Error>() {
            Some(io) if io.kind() == std::io::ErrorKind::InvalidData => return true,
            Some(io) => io.get_ref().map(|inner| inner as _),
            None => err.source(),
        };
    }
    false
}

async fn cancellable<T>(
    fut: impl std::future::Future<Output = T>,
    cancel: &CancelFlag,
) -> DocResult<T> {
    let mut fut = std::pin::pin!(fut);
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            () = tokio::time::sleep(CANCEL_POLL) => {
                if cancel.is_cancelled() {
                    return Err(DocError::Cancelled);
                }
            }
        }
    }
}

fn tokenize_shell(s: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_ansi = false;
    let mut chars = s.chars().peekable();
    let mut has_token = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' if in_ansi => push_ansi_escape(&mut chars, &mut buf),
            '\'' if in_ansi => in_ansi = false,
            _ if in_ansi => buf.push(c),
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

            '$' if !in_single && !in_double && chars.peek() == Some(&'\'') => {
                chars.next();
                in_ansi = true;
                has_token = true;
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
    if in_single || in_double || in_ansi {
        return Err("unterminated quote".to_string());
    }
    if has_token {
        out.push(buf);
    }
    Ok(out)
}

fn push_ansi_escape(chars: &mut std::iter::Peekable<std::str::Chars>, buf: &mut String) {
    let Some(c) = chars.next() else {
        buf.push('\\');
        return;
    };
    let digits = match c {
        'x' => 2,
        'u' => 4,
        'U' => 8,
        _ => 0,
    };
    if digits > 0 {
        let mut code = String::new();
        while code.len() < digits {
            let Some(d) = chars.next_if(char::is_ascii_hexdigit) else {
                break;
            };
            code.push(d);
        }
        match u32::from_str_radix(&code, 16).ok().and_then(char::from_u32) {
            Some(ch) => buf.push(ch),
            None => {
                buf.push('\\');
                buf.push(c);
                buf.push_str(&code);
            }
        }
        return;
    }
    match c {
        'n' => buf.push('\n'),
        't' => buf.push('\t'),
        'r' => buf.push('\r'),
        'e' | 'E' => buf.push('\x1b'),
        '\\' | '\'' | '"' | '?' => buf.push(c),
        other => {
            buf.push('\\');
            buf.push(other);
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    pub(crate) fn serve_once(response: Option<Vec<u8>>) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let raw = read_request(&mut stream);
            let _ = tx.send(raw);
            match response {
                Some(bytes) => {
                    let _ = stream.write_all(&bytes);
                }
                None => std::thread::sleep(Duration::from_secs(5)),
            }
        });
        (url, rx)
    }

    fn read_request(stream: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = stream.read(&mut chunk).unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf[0] == 0x16 {
                break; // a TLS handshake, which this plain server answers with plain text
            }
            let text = String::from_utf8_lossy(&buf);
            if let Some(end) = text.find("\r\n\r\n") {
                let length = text[..end]
                    .lines()
                    .find_map(|l| {
                        let (k, v) = l.split_once(':')?;
                        k.eq_ignore_ascii_case("content-length")
                            .then(|| v.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                if buf.len() >= end + 4 + length {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    pub(crate) fn reply(status: &str, content_type: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    fn request(cmd: &str) -> CurlRequest {
        parse(cmd).expect("parses")
    }

    async fn send_to(cmd: &str, limit: u64) -> DocResult<Sent> {
        send(&request(cmd), &CancelFlag::never(), limit).await
    }

    fn refusal(cmd: &str) -> Option<Refusal> {
        request(cmd).refusal
    }

    #[test]
    fn only_a_get_or_head_without_a_body_sends_on_paste() {
        let sends = |cmd: &str| request(cmd).preview().sends_on_paste;
        assert!(sends("curl https://x.dev/a"));
        assert!(sends("curl -I https://x.dev/a"));
        assert!(sends(
            "curl -sSL -H 'Authorization: Bearer t' https://x.dev/a"
        ));
        assert!(!sends("curl -X POST https://x.dev/a"));
        assert!(!sends("curl -X DELETE https://x.dev/a"));
        assert!(!sends("curl -d 'a=1' https://x.dev/a"));
        assert!(!sends("curl -X GET -d 'a=1' https://x.dev/a"));
        assert!(!sends("curl -k https://x.dev/a"));
    }

    #[test]
    fn the_preview_names_headers_but_never_shows_their_values() {
        let p = request(
            r#"curl -X PATCH https://x.dev/a -H 'Authorization: Bearer secret' -H 'X-Trace: 1' --json '{"a":1}'"#,
        )
        .preview();
        assert_eq!(p.method, "PATCH");
        assert_eq!(p.url.as_deref(), Some("https://x.dev/a"));
        assert_eq!(p.body_bytes, Some(7));
        assert!(p.header_names.contains(&"Authorization".to_string()));
        assert!(p.header_names.contains(&"X-Trace".to_string()));
        assert!(!format!("{p:?}").contains("secret"));
    }

    #[test]
    fn unsafe_or_unsupported_options_are_refused_by_name() {
        let insecure = |o: &str| Some(Refusal::Insecure { option: o.into() });
        let file = |o: &str| Some(Refusal::ReadsFile { option: o.into() });
        let unsupported = |o: &str| Some(Refusal::Unsupported { option: o.into() });
        assert_eq!(refusal("curl -k https://x.dev"), insecure("-k"));
        assert_eq!(
            refusal("curl --insecure https://x.dev"),
            insecure("--insecure")
        );
        assert_eq!(refusal("curl -sk https://x.dev"), insecure("-k"));
        assert_eq!(refusal("curl -d @body.json https://x.dev"), file("-d"));
        assert_eq!(refusal("curl --json @b.json https://x.dev"), file("--json"));
        assert_eq!(refusal("curl -b cookies.txt https://x.dev"), file("-b"));
        assert_eq!(refusal("curl -F a=1 https://x.dev"), unsupported("-F"));
        assert_eq!(
            refusal("curl --proxy http://p https://x.dev"),
            unsupported("--proxy")
        );
        assert_eq!(refusal("curl -G -d q=1 https://x.dev"), unsupported("-G"));
        assert_eq!(
            refusal("curl -u ada https://x.dev"),
            Some(Refusal::NoPassword)
        );
        assert_eq!(refusal("curl -X POST"), Some(Refusal::NoUrl));
        assert_eq!(refusal("curl --data-raw @literal https://x.dev"), None);
        assert_eq!(
            refusal("curl -sSLi --compressed -o out.json https://x.dev"),
            None
        );
        assert_eq!(refusal("curl -b 'a=1; b=2' https://x.dev"), None);
    }

    #[test]
    fn combined_and_attached_short_options_are_read_like_curl_reads_them() {
        let r = request("curl -sXPOST -H'X-A: 1' --header=X-B:2 -Lu ada:pw https://x.dev");
        assert_eq!(r.method, "POST");
        assert!(r.follow_redirects);
        assert_eq!(r.user, Some(("ada".into(), "pw".into())));
        assert_eq!(
            r.headers,
            vec![("X-A".into(), "1".into()), ("X-B".into(), "2".into())]
        );
    }

    #[test]
    fn ansi_c_quoting_from_chrome_copy_as_curl_is_unescaped() {
        let r = request(
            r#"curl $'https://x.dev/a' --data-raw $'{"note":"it\'s\\n","tab":"a\tb","e":"\x41é"}'"#,
        );
        assert_eq!(r.url.as_deref(), Some("https://x.dev/a"));
        assert_eq!(
            r.body.as_deref(),
            Some("{\"note\":\"it's\\n\",\"tab\":\"a\tb\",\"e\":\"Aé\"}")
        );
        assert_eq!(
            request("curl 'https://x.dev/$a'").url.as_deref(),
            Some("https://x.dev/$a")
        );
    }

    #[test]
    fn an_empty_header_removes_it_like_curl_does() {
        let r = request("curl -d a=1 -H 'Content-Type:' -H 'X-Empty:' https://x.dev");
        assert_eq!(r.preview().header_names, Vec::<String>::new());
    }

    #[test]
    fn the_tab_is_named_after_the_last_path_segment_or_the_host() {
        let name = |url: &str| request(&format!("curl {url}")).tab_name();
        assert_eq!(name("https://api.example.com/users/1"), "users-1.json");
        assert_eq!(
            name("https://api.example.com/v1/users?page=2"),
            "users.json"
        );
        assert_eq!(name("https://api.example.com/data.json"), "data.json");
        assert_eq!(name("https://api.example.com/"), "api.example.com.json");
        assert_eq!(name("example.com"), "example.com.json");
    }

    #[tokio::test]
    async fn a_get_is_sent_with_its_headers_and_the_body_streams_to_a_private_file() {
        let (url, got) = serve_once(Some(reply("200 OK", "application/json", r#"{"id":1}"#)));
        let sent = send_to(
            &format!("curl {url}/users/1 -H 'Accept: application/json' -H 'X-Key: k1' -u ada:pw"),
            1 << 20,
        )
        .await
        .unwrap();
        let raw = got.recv().unwrap();
        assert!(raw.starts_with("GET /users/1 HTTP/1.1\r\n"), "{raw}");
        assert!(raw.contains("accept: application/json\r\n"), "{raw}");
        assert!(raw.contains("x-key: k1\r\n"), "{raw}");
        assert!(raw.contains("authorization: Basic YWRhOnB3\r\n"), "{raw}");
        assert_eq!((sent.status, sent.status_text.as_str()), (200, "OK"));
        assert_eq!(
            std::fs::read_to_string(sent.file.path()).unwrap(),
            r#"{"id":1}"#
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(sent.file.path())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let path = sent.file.path().to_path_buf();
        drop(sent);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn a_compressed_response_from_a_browser_copied_command_is_decoded() {
        // `{"ok":true}` gzipped; browsers' "Copy as cURL" asks for compression.
        let body: &[u8] = &[
            0x1f, 0x8b, 0x8, 0x0, 0x0, 0x0, 0x0, 0x0, 0x2, 0xff, 0xab, 0x56, 0xca, 0xcf, 0x56,
            0xb2, 0x2a, 0x29, 0x2a, 0x4d, 0xad, 0x5, 0x0, 0x90, 0x5f, 0xd4, 0xa7, 0xb, 0x0, 0x0,
            0x0,
        ];
        let mut raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        raw.extend_from_slice(body);
        let (url, _got) = serve_once(Some(raw));
        let sent = send_to(
            &format!("curl '{url}/x' -H 'accept-encoding: gzip, deflate, br, zstd' --compressed"),
            1 << 20,
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(sent.file.path()).unwrap(),
            r#"{"ok":true}"#
        );
    }

    #[tokio::test]
    async fn method_headers_and_body_are_forwarded_exactly() {
        let (url, got) = serve_once(Some(reply("201 Created", "application/json", "{}")));
        let cmd = format!(
            r#"curl -X PUT {url}/items/7 -H 'Content-Type: application/json' -H 'X-Trace: abc' -d '{{"name":"Ada"}}'"#
        );
        let sent = send_to(&cmd, 1 << 20).await.unwrap();
        let raw = got.recv().unwrap();
        assert!(raw.starts_with("PUT /items/7 HTTP/1.1\r\n"), "{raw}");
        assert!(raw.contains("content-type: application/json\r\n"), "{raw}");
        assert!(!raw.contains("x-www-form-urlencoded"), "{raw}");
        assert!(raw.contains("x-trace: abc\r\n"), "{raw}");
        assert!(raw.ends_with("\r\n\r\n{\"name\":\"Ada\"}"), "{raw}");
        assert_eq!(sent.status, 201);
    }

    #[tokio::test]
    async fn json_and_data_add_the_content_type_curl_adds() {
        let (url, got) = serve_once(Some(reply("200 OK", "application/json", "{}")));
        send_to(&format!("curl --json '{{\"a\":1}}' {url}"), 1 << 20)
            .await
            .unwrap();
        let raw = got.recv().unwrap();
        assert!(raw.starts_with("POST / HTTP/1.1\r\n"), "{raw}");
        assert!(raw.contains("content-type: application/json\r\n"), "{raw}");
        assert!(raw.contains("accept: application/json\r\n"), "{raw}");

        let (url, got) = serve_once(Some(reply("200 OK", "application/json", "{}")));
        send_to(&format!("curl -d a=1 -d b=2 {url}"), 1 << 20)
            .await
            .unwrap();
        let raw = got.recv().unwrap();
        assert!(
            raw.contains("content-type: application/x-www-form-urlencoded\r\n"),
            "{raw}"
        );
        assert!(raw.ends_with("\r\n\r\na=1&b=2"), "{raw}");
    }

    #[tokio::test]
    async fn an_emptied_header_is_not_sent() {
        let (url, got) = serve_once(Some(reply("200 OK", "application/json", "{}")));
        send_to(
            &format!("curl -d a=1 -H 'Content-Type:' -H 'X-Empty:' {url}"),
            1 << 20,
        )
        .await
        .unwrap();
        let raw = got.recv().unwrap().to_ascii_lowercase();
        assert!(!raw.contains("content-type"), "{raw}");
        assert!(!raw.contains("x-empty"), "{raw}");
    }

    #[tokio::test]
    async fn a_corrupt_compressed_body_is_not_reported_as_a_certificate_problem() {
        let body = b"definitely not gzip";
        let mut raw = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        raw.extend_from_slice(body);
        let (url, _got) = serve_once(Some(raw));
        let err = send_to(&format!("curl {url}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::Interrupted { .. })),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn an_error_status_still_returns_its_body() {
        let (url, _got) = serve_once(Some(reply(
            "404 Not Found",
            "application/json",
            r#"{"error":"no such user"}"#,
        )));
        let sent = send_to(&format!("curl {url}/users/9"), 1 << 20)
            .await
            .unwrap();
        assert_eq!((sent.status, sent.status_text.as_str()), (404, "Not Found"));
        assert_eq!(
            std::fs::read_to_string(sent.file.path()).unwrap(),
            r#"{"error":"no such user"}"#
        );
    }

    #[tokio::test]
    async fn a_response_over_the_limit_is_refused() {
        let body = "x".repeat(4096);
        let streamed = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}"
        );
        let (url, _got) = serve_once(Some(streamed.into_bytes()));
        let err = send_to(&format!("curl {url}"), 1000).await.err().unwrap();
        assert!(
            matches!(
                &err,
                DocError::Request(RequestProblem::TooLarge { limit: 1000 })
            ),
            "{err:?}"
        );

        let (url, _got) = serve_once(Some(reply("200 OK", "application/json", &body)));
        let err = send_to(&format!("curl {url}"), 1000).await.err().unwrap();
        assert!(matches!(
            err,
            DocError::Request(RequestProblem::TooLarge { .. })
        ));
    }

    #[tokio::test]
    async fn a_page_that_is_not_data_is_refused_by_its_content_type() {
        let (url, _got) = serve_once(Some(reply(
            "500 Internal Server Error",
            "text/html; charset=utf-8",
            "<html></html>",
        )));
        let err = send_to(&format!("curl {url}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::NotData { content_type, status: 500 }) if content_type == "text/html"),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn cancelling_stops_a_request_that_is_waiting_for_the_server() {
        let (url, _got) = serve_once(None);
        let cancel = CancelFlag::default();
        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            flag.cancel();
        });
        let started = std::time::Instant::now();
        let err = send(&request(&format!("curl {url}")), &cancel, 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(matches!(err, DocError::Cancelled), "{err:?}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn a_server_that_never_answers_times_out_by_max_time() {
        let (url, _got) = serve_once(None);
        let err = send_to(&format!("curl -m 0.3 {url}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::TimedOut { host }) if host.starts_with("127.0.0.1:")),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn a_closed_port_is_unreachable_and_a_plain_server_on_https_is_a_tls_failure() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let err = send_to(&format!("curl http://127.0.0.1:{port}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::Unreachable { .. })),
            "{err:?}"
        );

        let (url, _got) = serve_once(Some(reply("200 OK", "application/json", "{}")));
        let https = url.replace("http://", "https://");
        let err = send_to(&format!("curl {https}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::Tls { .. })),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn a_refused_command_is_never_sent() {
        let (url, got) = serve_once(Some(reply("200 OK", "application/json", "{}")));
        let err = send_to(&format!("curl -k {url}"), 1 << 20)
            .await
            .err()
            .unwrap();
        assert!(
            matches!(&err, DocError::Request(RequestProblem::Refused { .. })),
            "{err:?}"
        );
        assert!(got.recv_timeout(Duration::from_millis(200)).is_err());
    }
}
