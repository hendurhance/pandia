use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::lazy::prescan;

static UNESCAPE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\\+)(.)").unwrap());

static IS_ESCAPED_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\\+["/nrtbf]"#).unwrap());

const SAMPLE_HEAD_TAIL: usize = 50_000;

#[derive(Debug, Clone)]
pub struct Repaired {
    pub json: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepUnescapeResult {
    pub result: String,
    pub iterations: u32,
    pub success: bool,
    pub error: Option<String>,
}

pub fn unescape(text: &str) -> String {
    UNESCAPE_RE
        .replace_all(text, |caps: &regex::Captures| {
            let backslashes = &caps[1];
            let ch = &caps[2];
            let count = backslashes.len();
            let half = count / 2;
            let prefix: String = std::iter::repeat_n('\\', half).collect();

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
                    return format!("{prefix}{target}");
                }
            }
            let extra = if count % 2 == 1 { "\\" } else { "" };
            format!("{prefix}{extra}{ch}")
        })
        .into_owned()
}

pub fn is_escaped(text: &str) -> bool {
    if text.len() > 100_000 {
        let head_end = nearest_boundary(text, SAMPLE_HEAD_TAIL, false);
        let tail_start = nearest_boundary(text, text.len().saturating_sub(SAMPLE_HEAD_TAIL), true);
        return IS_ESCAPED_RE.is_match(&text[..head_end])
            || IS_ESCAPED_RE.is_match(&text[tail_start..]);
    }
    IS_ESCAPED_RE.is_match(text)
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
        if is_valid(&current) {
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
    match check_json(&current) {
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
            error: Some(format!("Parse failed after {iterations} iterations: {e}")),
        },
    }
}

fn structure_is_escaped(body: &str) -> bool {
    body.trim_start_matches(|c: char| c == '{' || c == '[' || c.is_whitespace())
        .starts_with('\\')
}

// IgnoredAny skips `\u` escape checks, so a lone surrogate passed it and then failed to load.
// This decodes every string the way loading does, without building a tree.
struct Checked;

impl<'de> serde::Deserialize<'de> for Checked {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(Checked)
    }
}

impl<'de> serde::de::Visitor<'de> for Checked {
    type Value = Checked;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a JSON value")
    }
    fn visit_bool<E>(self, _: bool) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_i64<E>(self, _: i64) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_u64<E>(self, _: u64) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_f64<E>(self, _: f64) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_str<E>(self, _: &str) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_unit<E>(self) -> Result<Checked, E> {
        Ok(Checked)
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Checked, A::Error> {
        while seq.next_element::<Checked>()?.is_some() {}
        Ok(Checked)
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Checked, A::Error> {
        while map.next_entry::<Checked, Checked>()?.is_some() {}
        Ok(Checked)
    }
}

pub fn check_json(text: &str) -> serde_json::Result<()> {
    prescan(text).map_err(serde::de::Error::custom)?;
    let mut de = serde_json::Deserializer::from_str(text);
    de.disable_recursion_limit();
    Checked::deserialize(&mut de)?;
    de.end()
}

fn is_valid(text: &str) -> bool {
    check_json(text).is_ok()
}

pub fn repair(input: &str) -> Option<Repaired> {
    let mut notes = Notes::default();
    let body = strip_wrappers(input, &mut notes);
    if body.trim().is_empty() {
        return None;
    }
    if is_valid(body) {
        return Some(Repaired {
            json: body.to_string(),
            notes: notes.sentences(),
        });
    }

    let unescaped;
    let mut body = body;
    if structure_is_escaped(body) {
        let r = deep_unescape(body, 5);
        if r.iterations > 0 {
            notes.unescape_levels = r.iterations;
            if r.success {
                return Some(Repaired {
                    json: r.result,
                    notes: notes.sentences(),
                });
            }
            unescaped = r.result;
            body = &unescaped;
        }
    }

    let json = Scanner::new(body.as_bytes(), &mut notes).run();
    is_valid(&json).then(|| Repaired {
        json,
        notes: notes.sentences(),
    })
}

fn strip_wrappers<'a>(input: &'a str, notes: &mut Notes) -> &'a str {
    let mut s = input;
    if let Some(rest) = s.strip_prefix('\u{feff}') {
        s = rest;
        notes.bom = true;
    }
    s = s.trim();
    let callee_end = s
        .bytes()
        .position(|b| !(b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b == b'.'))
        .unwrap_or(s.len());
    let after_callee = s[callee_end..].trim_start();
    if after_callee.starts_with('(') {
        let inner_end = s.trim_end().trim_end_matches(';').trim_end();
        if let Some(inner) = inner_end.strip_suffix(')') {
            let open = s.len() - after_callee.len();
            if open < inner.len() {
                if callee_end > 0 {
                    notes.jsonp = true;
                } else {
                    notes.parens = true;
                }
                return inner[open + 1..].trim();
            }
        }
    }
    s
}

#[derive(Default)]
struct Notes {
    bom: bool,
    jsonp: bool,
    parens: bool,
    unescape_levels: u32,
    comments: u32,
    trailing_commas: u32,
    extra_commas: u32,
    semicolons: u32,
    single_quoted: u32,
    quoted_keys: u32,
    colons: u32,
    nulled: u32,
    escapes: u32,
    lone_surrogates: u32,
    controls: u32,
    mismatched: u32,
    extra_closers: u32,
    records: u32,
    cut_in_string: bool,
    dropped_keys: u32,
    closed: u32,
}

fn count(n: u32, one: &str, many: &str) -> String {
    if n == 1 {
        one.to_string()
    } else {
        many.replace("{n}", &n.to_string())
    }
}

impl Notes {
    fn sentences(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut add = |cond: bool, text: String| {
            if cond {
                out.push(text);
            }
        };
        add(self.bom, "Removed the byte order mark at the start.".into());
        add(
            self.jsonp,
            "Removed the JSONP callback around the data.".into(),
        );
        add(
            self.parens,
            "Removed the parentheses around the data.".into(),
        );
        add(
            self.unescape_levels > 0,
            count(
                self.unescape_levels,
                "Unescaped JSON that was stored as a string.",
                "Unescaped JSON that was stored as a string, {n} levels deep.",
            ),
        );
        add(
            self.comments > 0,
            count(self.comments, "Removed a comment.", "Removed {n} comments."),
        );
        add(
            self.trailing_commas > 0,
            count(
                self.trailing_commas,
                "Removed a trailing comma.",
                "Removed {n} trailing commas.",
            ),
        );
        add(
            self.extra_commas > 0,
            count(
                self.extra_commas,
                "Removed an extra comma.",
                "Removed {n} extra commas.",
            ),
        );
        add(
            self.semicolons > 0,
            count(
                self.semicolons,
                "Replaced a semicolon between values with a comma.",
                "Replaced {n} semicolons between values with commas.",
            ),
        );
        add(
            self.single_quoted > 0,
            count(
                self.single_quoted,
                "Turned a single-quoted string into a double-quoted one.",
                "Turned {n} single-quoted strings into double-quoted ones.",
            ),
        );
        add(
            self.quoted_keys > 0,
            count(
                self.quoted_keys,
                "Added quotes around a key.",
                "Added quotes around {n} keys.",
            ),
        );
        add(
            self.colons > 0,
            count(
                self.colons,
                "Added a missing colon.",
                "Added {n} missing colons.",
            ),
        );
        add(
            self.nulled > 0,
            count(
                self.nulled,
                "Replaced an undefined, NaN or Infinity value with null.",
                "Replaced {n} undefined, NaN or Infinity values with null.",
            ),
        );
        add(
            self.escapes > 0,
            count(
                self.escapes,
                "Kept a backslash that didn't start a valid escape.",
                "Kept {n} backslashes that didn't start a valid escape.",
            ),
        );
        add(
            self.lone_surrogates > 0,
            count(
                self.lone_surrogates,
                "Replaced a broken character escape with �.",
                "Replaced {n} broken character escapes with �.",
            ),
        );
        add(
            self.controls > 0,
            count(
                self.controls,
                "Escaped a line break or control character inside a string.",
                "Escaped {n} line breaks or control characters inside strings.",
            ),
        );
        add(
            self.mismatched > 0,
            count(
                self.mismatched,
                "Fixed a closing bracket that didn't match its opening one.",
                "Fixed {n} closing brackets that didn't match their opening ones.",
            ),
        );
        add(
            self.extra_closers > 0,
            count(
                self.extra_closers,
                "Removed a closing bracket with nothing to close.",
                "Removed {n} closing brackets with nothing to close.",
            ),
        );
        add(
            self.records > 1,
            format!("Joined {} records into an array.", self.records),
        );
        add(
            self.cut_in_string,
            "The file ended inside a string, so its last value may be incomplete.".into(),
        );
        add(
            self.dropped_keys > 0,
            count(
                self.dropped_keys,
                "Dropped the last key, which had no value.",
                "Dropped {n} keys that had no value.",
            ),
        );
        add(
            self.closed > 0,
            count(
                self.closed,
                "Closed a bracket the file ended without.",
                "Closed {n} brackets the file ended without.",
            ),
        );
        out
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Slot {
    KeyOrEnd,
    Colon,
    Value,
    CommaOrEnd,
}

struct Frame {
    object: bool,
    slot: Slot,
    member_start: usize,
}

struct Scanner<'a> {
    src: &'a [u8],
    i: usize,
    out: Vec<u8>,
    stack: Vec<Frame>,
    pending_comma: bool,
    records: u32,
    first_start: usize,
    notes: &'a mut Notes,
}

impl<'a> Scanner<'a> {
    fn new(src: &'a [u8], notes: &'a mut Notes) -> Self {
        Self {
            src,
            i: 0,
            out: Vec::with_capacity(src.len() + 16),
            stack: Vec::new(),
            pending_comma: false,
            records: 0,
            first_start: 0,
            notes,
        }
    }

    fn run(mut self) -> String {
        while self.i < self.src.len() {
            let b = self.src[self.i];
            match b {
                b' ' | b'\t' | b'\n' | b'\r' => {
                    self.out.push(b);
                    self.i += 1;
                }
                b'"' | b'\'' => self.string(b),
                b'/' if self.peek(1) == Some(b'/') || self.peek(1) == Some(b'*') => self.comment(),
                b'{' | b'[' => {
                    self.begin_token();
                    self.out.push(b);
                    self.i += 1;
                    let start = self.out.len();
                    self.stack.push(Frame {
                        object: b == b'{',
                        slot: if b == b'{' {
                            Slot::KeyOrEnd
                        } else {
                            Slot::Value
                        },
                        member_start: start,
                    });
                }
                b'}' | b']' => self.close(b),
                b',' => self.comma(),
                b';' => {
                    if self.top_slot() == Some(Slot::CommaOrEnd) {
                        self.notes.semicolons += 1;
                        self.comma();
                    } else {
                        self.i += 1;
                    }
                }
                b':' => {
                    if self.top_slot() == Some(Slot::Colon) {
                        self.set_slot(Slot::Value);
                    }
                    self.out.push(b);
                    self.i += 1;
                }
                b'-' if self.word_at(self.i + 1) == b"Infinity" => {
                    self.begin_token();
                    self.out.extend_from_slice(b"null");
                    self.notes.nulled += 1;
                    self.i += 1 + b"Infinity".len();
                    self.after_value();
                }
                b if b.is_ascii_alphabetic() || b == b'_' || b == b'$' => self.word(),
                b if b.is_ascii_digit() || b == b'-' || b == b'+' || b == b'.' => self.number(),
                _ => {
                    self.out.push(b);
                    self.i += 1;
                }
            }
        }
        self.finish();
        String::from_utf8(self.out).unwrap_or_default()
    }

    fn peek(&self, ahead: usize) -> Option<u8> {
        self.src.get(self.i + ahead).copied()
    }

    fn top_slot(&self) -> Option<Slot> {
        self.stack.last().map(|f| f.slot)
    }

    fn set_slot(&mut self, slot: Slot) {
        if let Some(f) = self.stack.last_mut() {
            f.slot = slot;
        }
    }

    fn in_key_position(&self) -> bool {
        matches!(self.stack.last(), Some(f) if f.object && f.slot == Slot::KeyOrEnd)
    }

    fn begin_token(&mut self) {
        if self.stack.is_empty() {
            self.start_record();
        }
        let key = self.in_key_position();
        if key {
            let start = self.out.len();
            if let Some(f) = self.stack.last_mut() {
                f.member_start = start;
            }
        }
        if self.top_slot() == Some(Slot::Colon) {
            let gap = self
                .out
                .iter()
                .rev()
                .take_while(|b| b.is_ascii_whitespace())
                .count();
            self.out.insert(self.out.len() - gap, b':');
            self.notes.colons += 1;
            self.set_slot(Slot::Value);
        }
        if self.pending_comma {
            self.out.push(b',');
            self.pending_comma = false;
        }
    }

    // Back-to-back top-level values, like NDJSON, only load as one document inside an array.
    fn start_record(&mut self) {
        match self.records {
            0 => self.first_start = self.out.len(),
            1 => {
                self.out.insert(self.first_start, b'[');
                self.out.push(b',');
            }
            _ => self.out.push(b','),
        }
        self.records += 1;
    }

    fn after_value(&mut self) {
        if let Some(f) = self.stack.last_mut() {
            if f.slot == Slot::Value || (!f.object && f.slot != Slot::CommaOrEnd) {
                f.slot = Slot::CommaOrEnd;
            }
        }
    }

    fn after_scalar_token(&mut self, was_key: bool) {
        if was_key {
            self.set_slot(Slot::Colon);
        } else {
            self.after_value();
        }
    }

    fn string(&mut self, quote: u8) {
        let was_key = self.in_key_position();
        self.begin_token();
        if quote == b'\'' {
            self.notes.single_quoted += 1;
        }
        self.out.push(b'"');
        self.i += 1;
        loop {
            let Some(&b) = self.src.get(self.i) else {
                self.notes.cut_in_string = true;
                self.out.push(b'"');
                break;
            };
            self.i += 1;
            match b {
                _ if b == quote => {
                    self.out.push(b'"');
                    break;
                }
                b'"' => self.out.extend_from_slice(b"\\\""),
                b'\\' => self.escape(quote),
                b'\n' => self.control(b"\\n"),
                b'\r' => self.control(b"\\r"),
                b'\t' => self.control(b"\\t"),
                0x08 => self.control(b"\\b"),
                0x0c => self.control(b"\\f"),
                b if b < 0x20 => {
                    self.notes.controls += 1;
                    self.out.extend_from_slice(format!("\\u{b:04x}").as_bytes());
                }
                _ => self.out.push(b),
            }
        }
        self.after_scalar_token(was_key);
    }

    fn control(&mut self, escaped: &[u8]) {
        self.notes.controls += 1;
        self.out.extend_from_slice(escaped);
    }

    fn escape(&mut self, quote: u8) {
        let Some(&next) = self.src.get(self.i) else {
            self.notes.escapes += 1;
            self.out.extend_from_slice(b"\\\\");
            return;
        };
        let unit = if next == b'u' {
            self.hex4_at(self.i + 1)
        } else {
            None
        };
        if let Some(unit @ 0xD800..=0xDFFF) = unit {
            self.surrogate(unit);
        } else if matches!(next, b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't')
            || unit.is_some()
        {
            self.out.push(b'\\');
            self.out.push(next);
            self.i += 1;
        } else if quote == b'\'' && next == b'\'' {
            self.out.push(b'\'');
            self.i += 1;
        } else {
            self.notes.escapes += 1;
            self.out.extend_from_slice(b"\\\\");
        }
    }

    fn hex4_at(&self, at: usize) -> Option<u16> {
        self.src
            .get(at..at + 4)?
            .iter()
            .try_fold(0, |n, &d| Some(n << 4 | (d as char).to_digit(16)? as u16))
    }

    // Only a high surrogate followed straight away by a low one decodes; any other
    // surrogate fails to load, so it becomes U+FFFD.
    fn surrogate(&mut self, unit: u16) {
        let paired = unit < 0xDC00
            && self.src.get(self.i + 5..self.i + 7) == Some(b"\\u".as_slice())
            && matches!(self.hex4_at(self.i + 7), Some(0xDC00..=0xDFFF));
        if paired {
            self.out.push(b'\\');
            self.out.extend_from_slice(&self.src[self.i..self.i + 11]);
            self.i += 11;
        } else {
            self.notes.lone_surrogates += 1;
            self.out.extend_from_slice("\u{fffd}".as_bytes());
            self.i += 5;
        }
    }

    fn comment(&mut self) {
        self.notes.comments += 1;
        if self.peek(1) == Some(b'/') {
            while self.i < self.src.len() && self.src[self.i] != b'\n' {
                self.i += 1;
            }
            return;
        }
        self.i += 2;
        while self.i < self.src.len() && !(self.src[self.i] == b'*' && self.peek(1) == Some(b'/')) {
            self.i += 1;
        }
        self.i = (self.i + 2).min(self.src.len());
    }

    fn comma(&mut self) {
        self.i += 1;
        match self.stack.last_mut() {
            Some(f) if f.slot == Slot::CommaOrEnd && !self.pending_comma => {
                f.slot = if f.object {
                    Slot::KeyOrEnd
                } else {
                    Slot::Value
                };
                self.pending_comma = true;
            }
            _ => self.notes.extra_commas += 1,
        }
    }

    fn close(&mut self, b: u8) {
        self.i += 1;
        if self.pending_comma {
            self.pending_comma = false;
            self.notes.trailing_commas += 1;
        }
        let Some(frame) = self.stack.pop() else {
            self.notes.extra_closers += 1;
            return;
        };
        self.drop_dangling_key(&frame);
        let closer = if frame.object { b'}' } else { b']' };
        if closer != b {
            self.notes.mismatched += 1;
        }
        self.out.push(closer);
        self.after_value();
    }

    fn drop_dangling_key(&mut self, frame: &Frame) {
        if frame.object && matches!(frame.slot, Slot::Colon | Slot::Value) {
            self.out.truncate(frame.member_start);
            self.notes.dropped_keys += 1;
        }
    }

    fn word_at(&self, at: usize) -> &'a [u8] {
        let src = self.src;
        let at = at.min(src.len());
        let end = src[at..]
            .iter()
            .position(|b| !(b.is_ascii_alphanumeric() || *b == b'_' || *b == b'$'))
            .map_or(src.len(), |p| at + p);
        &src[at..end]
    }

    fn word(&mut self) {
        let word = self.word_at(self.i);
        let len = word.len();
        let was_key = self.in_key_position();
        self.begin_token();
        if was_key {
            self.notes.quoted_keys += 1;
            self.out.push(b'"');
            self.out.extend_from_slice(word);
            self.out.push(b'"');
        } else {
            match word {
                b"undefined" | b"NaN" | b"Infinity" => {
                    self.notes.nulled += 1;
                    self.out.extend_from_slice(b"null");
                }
                _ => self.out.extend_from_slice(word),
            }
        }
        self.i += len;
        self.after_scalar_token(was_key);
    }

    fn number(&mut self) {
        self.begin_token();
        let start = self.i;
        while self.i < self.src.len()
            && matches!(
                self.src[self.i],
                b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'
            )
        {
            self.i += 1;
        }
        self.out.extend_from_slice(&self.src[start..self.i]);
        self.after_value();
    }

    fn finish(&mut self) {
        if self.pending_comma {
            self.pending_comma = false;
            self.notes.trailing_commas += 1;
        }
        while let Some(frame) = self.stack.pop() {
            self.drop_dangling_key(&frame);
            self.out.push(if frame.object { b'}' } else { b']' });
            self.notes.closed += 1;
            self.after_value();
        }
        if self.records > 1 {
            self.out.push(b']');
            self.notes.records = self.records;
        }
    }
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

    static ESCAPE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[\\"\u{0000}-\u{001F}/]"#).unwrap());

    fn escape(text: &str) -> String {
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

    fn fixed(input: &str) -> (serde_json::Value, Vec<String>) {
        let r = repair(input).unwrap_or_else(|| panic!("repair failed for {input:?}"));
        let v = serde_json::from_str(&r.json).expect("repaired text must be valid JSON");
        (v, r.notes)
    }

    #[test]
    fn already_valid_json_passes_through() {
        let r = repair(r#"{"a": 1}"#).unwrap();
        assert_eq!(r.json, r#"{"a": 1}"#);
        assert!(r.notes.is_empty());
    }

    #[test]
    fn trailing_comma_in_object() {
        let (v, notes) = fixed(r#"{"a": 1,}"#);
        assert_eq!(v["a"], 1);
        assert_eq!(notes, ["Removed a trailing comma."]);
    }

    #[test]
    fn trailing_comma_in_array() {
        let (v, _) = fixed(r#"[1, 2, 3,]"#);
        assert_eq!(v.as_array().unwrap().len(), 3);
    }

    #[test]
    fn single_quotes_converted_to_double() {
        let (v, _) = fixed("{'a': 'hello'}");
        assert_eq!(v["a"], "hello");
    }

    #[test]
    fn unquoted_keys_get_quoted() {
        let (v, notes) = fixed("{a: 1, b: 2}");
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], 2);
        assert!(notes.contains(&"Added quotes around 2 keys.".to_string()));
    }

    #[test]
    fn comments_removed() {
        let (v, _) = fixed("{\"a\": 1 , \"b\": 2 // line\n}");
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], 2);
    }

    #[test]
    fn undefined_nan_infinity_become_null() {
        let (v, _) = fixed(r#"{"a": undefined, "b": NaN, "c": Infinity, "d": -Infinity}"#);
        for k in ["a", "b", "c", "d"] {
            assert!(v[k].is_null(), "{k}");
        }
    }

    #[test]
    fn missing_closing_bracket() {
        let (v, notes) = fixed(r#"{"a": [1, 2"#);
        assert_eq!(v["a"].as_array().unwrap().len(), 2);
        assert!(notes.contains(&"Closed 2 brackets the file ended without.".to_string()));
    }

    #[test]
    fn mismatched_closing_bracket() {
        let (v, _) = fixed(r#"{"a": [1, 2}"#);
        assert_eq!(v["a"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn jsonp_callback_unwrapped() {
        let (v, notes) = fixed("callback({\"a\": 1});");
        assert_eq!(v["a"], 1);
        assert_eq!(notes, ["Removed the JSONP callback around the data."]);
    }

    #[test]
    fn bom_stripped() {
        let (_, notes) = fixed(&format!("\u{feff}{}", r#"{"a": 1}"#));
        assert_eq!(notes, ["Removed the byte order mark at the start."]);
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
        let step2 = escape(&escape(r#"{"a":1}"#));
        let r = deep_unescape(&step2, 5);
        assert!(r.success, "result: {} error: {:?}", r.result, r.error);
    }

    #[test]
    fn ordinary_escapes_in_a_cut_off_file_are_kept() {
        let (v, notes) = fixed(r#"[{"path":"C:\\new\\file.txt"},{"path":"C:\\te"#);
        assert_eq!(v[0]["path"], "C:\\new\\file.txt");
        assert!(!notes.iter().any(|n| n.contains("Unescaped")), "{notes:?}");

        let (v, _) = fixed(r#"[{"msg":"say \"hi\""},{"msg":"cut"#);
        assert_eq!(v[0]["msg"], "say \"hi\"");
    }

    #[test]
    fn escaped_json_repairs_with_a_plain_note() {
        let (v, notes) = fixed(r#"{\"a\": 1}"#);
        assert_eq!(v["a"], 1);
        assert_eq!(notes, ["Unescaped JSON that was stored as a string."]);
    }

    #[test]
    fn empty_input_cannot_be_repaired() {
        assert!(repair("").is_none());
        assert!(repair("   ").is_none());
    }

    #[test]
    fn unterminated_string_at_eof_in_array() {
        let (v, notes) = fixed(r#"[{"id": "abc"},{"id": "CPHR246457BD0"#);
        let arr = v.as_array().expect("root must be array");
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[1]["id"], "CPHR246457BD0");
        assert!(notes.contains(
            &"The file ended inside a string, so its last value may be incomplete.".to_string()
        ));
    }

    #[test]
    fn unterminated_string_in_simple_object() {
        let (v, _) = fixed(r#"{"key": "value"#);
        assert_eq!(v["key"], "value");
    }

    #[test]
    fn unrecoverable_garbage_reports_failure() {
        assert!(repair("@@@@##!!@@").is_none());
    }

    #[test]
    fn never_changes_the_text_inside_strings() {
        let (v, _) = fixed(
            r#"[{"url": "https://example.com/a", "note": "it's fine", "c": "/* not a comment */", "n": "NaN", "k": "x: y, z"},]"#,
        );
        let row = &v[0];
        assert_eq!(row["url"], "https://example.com/a");
        assert_eq!(row["note"], "it's fine");
        assert_eq!(row["c"], "/* not a comment */");
        assert_eq!(row["n"], "NaN");
        assert_eq!(row["k"], "x: y, z");
    }

    #[test]
    fn a_cut_off_one_line_file_keeps_every_record() {
        let (v, notes) = fixed(
            r#"[{"id":1,"url":"https://example.com/a","name":"first"},{"id":2,"url":"https://example.com/b","name":"second"},{"id":3,"name":"cut off her"#,
        );
        let rows = v.as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["url"], "https://example.com/a");
        assert_eq!(rows[1]["name"], "second");
        assert_eq!(rows[2]["name"], "cut off her");
        assert!(notes.iter().any(|n| n.contains("may be incomplete")));
    }

    #[test]
    fn a_cut_off_multi_line_file_repairs() {
        let (v, _) = fixed(
            "[\n  {\"id\": 1, \"url\": \"https://example.com/a\", \"note\": \"it's fine\"},\n  {\"id\": 2, \"url\": \"https://example.com/b\", \"note\": \"ok\"\n",
        );
        let rows = v.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["note"], "it's fine");
        assert_eq!(rows[1]["url"], "https://example.com/b");
    }

    #[test]
    fn a_key_the_file_never_gave_a_value_is_dropped() {
        let (v, notes) = fixed(r#"{"a": 1, "b""#);
        assert_eq!(v, serde_json::json!({ "a": 1 }));
        assert!(notes.contains(&"Dropped the last key, which had no value.".to_string()));
        let (v, _) = fixed(r#"{"a": 1, "b": "#);
        assert_eq!(v, serde_json::json!({ "a": 1 }));
    }

    #[test]
    fn a_missing_colon_is_added_and_the_key_and_value_are_kept() {
        let r = repair(r#"{"a" 1}"#).unwrap();
        assert_eq!(r.json, r#"{"a": 1}"#);
        assert_eq!(r.notes, ["Added a missing colon."]);
        let (v, notes) = fixed(r#"{"a" "b", "c" [1]}"#);
        assert_eq!(v, serde_json::json!({ "a": "b", "c": [1] }));
        assert_eq!(notes, ["Added 2 missing colons."]);
        let (v, _) = fixed(r#"{"a" 1, "b": 2}"#);
        assert_eq!(v, serde_json::json!({ "a": 1, "b": 2 }));
        let (v, _) = fixed(r#"{"a" {"b" true}}"#);
        assert_eq!(v, serde_json::json!({ "a": { "b": true } }));
    }

    #[test]
    fn nesting_up_to_the_open_limit_is_checked_and_repaired() {
        let nested = |depth: usize, inner: &str| {
            format!("{}{inner}{}", "[".repeat(depth), "]".repeat(depth))
        };
        assert!(check_json(&nested(1000, "1")).is_ok());
        assert!(check_json(&nested(1001, "1")).is_err());
        assert!(check_json(&nested(100_000, "1")).is_err());
        assert!(repair(&nested(500, "1,")).is_some());
    }

    #[test]
    fn single_quoted_strings_keep_their_double_quotes_and_apostrophes() {
        let (v, _) = fixed(r#"{'say': 'she said "hi"', 'it': 'it\'s'}"#);
        assert_eq!(v["say"], r#"she said "hi""#);
        assert_eq!(v["it"], "it's");
    }

    #[test]
    fn raw_line_breaks_in_strings_are_escaped_not_removed() {
        let (v, notes) = fixed("{\"a\": \"line one\nline two\",}");
        assert_eq!(v["a"], "line one\nline two");
        assert!(notes
            .contains(&"Escaped a line break or control character inside a string.".to_string()));
    }

    #[test]
    fn a_lone_surrogate_escape_becomes_a_replacement_character() {
        let (v, notes) = fixed(r#"{"a": "\ud83d", "b": "\udc00x", "ok": "😀"}"#);
        assert_eq!(v["a"], "\u{fffd}");
        assert_eq!(v["b"], "\u{fffd}x");
        assert_eq!(v["ok"], "😀");
        assert_eq!(notes, ["Replaced 2 broken character escapes with �."]);
    }

    #[test]
    fn ndjson_with_a_cut_off_last_line_joins_into_an_array() {
        let (v, notes) = fixed("{\"id\":1}\n{\"id\":2}\n{\"id\":3,\"n\":\"c");
        assert_eq!(
            v,
            serde_json::json!([{"id": 1}, {"id": 2}, {"id": 3, "n": "c"}])
        );
        assert!(
            notes.contains(&"Joined 3 records into an array.".to_string()),
            "{notes:?}"
        );
    }

    #[test]
    fn notes_are_plain_sentences() {
        let r = repair("{a: 1, /* c */ b: [1,,2],}").unwrap();
        assert!(!r.notes.is_empty());
        for note in &r.notes {
            assert!(note.ends_with('.'), "{note}");
            assert!(
                !note.contains('\\') && !note.contains("(?"),
                "no regex text: {note}"
            );
        }
    }
}
