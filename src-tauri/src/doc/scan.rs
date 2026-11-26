use std::borrow::Cow;

use super::lazy::{key_text, INDEX_STRIDE, MAX_DEPTH};
use super::progress::{OpenPhase, Reporter, TICK_BYTES};

#[derive(Debug, PartialEq)]
pub struct Scanned {
    pub repeated_keys: Vec<usize>,
    pub surrogate_escape: bool,
    pub root_items: Option<RootItems>,
}

#[derive(Debug, PartialEq)]
pub struct RootItems {
    pub len: u32,
    pub checkpoints: Vec<u64>,
}

#[derive(Debug, PartialEq)]
pub struct Rejected;

type Step = Result<(), Rejected>;

enum Frame {
    Array,
    Object {
        at: usize,
        keys_from: usize,
        escaped: bool,
    },
}

pub fn scan(
    bytes: &[u8],
    ahead: &mut dyn FnMut(usize) -> bool,
    progress: Reporter,
) -> Result<Scanned, Rejected> {
    let mut scanner = Scanner {
        bytes,
        i: 0,
        stack: Vec::new(),
        keys: Vec::new(),
        repeated: Vec::new(),
        surrogate: false,
        root: None,
        window_end: 0,
    };
    scanner.run(ahead, progress)?;
    scanner.repeated.sort_unstable();
    Ok(Scanned {
        repeated_keys: scanner.repeated,
        surrogate_escape: scanner.surrogate,
        root_items: scanner.root,
    })
}

struct Scanner<'a> {
    bytes: &'a [u8],
    i: usize,
    stack: Vec<Frame>,
    keys: Vec<(usize, usize)>,
    repeated: Vec<usize>,
    surrogate: bool,
    root: Option<RootItems>,
    window_end: usize,
}

impl<'a> Scanner<'a> {
    fn run(&mut self, ahead: &mut dyn FnMut(usize) -> bool, progress: Reporter) -> Step {
        'value: loop {
            if self.i >= self.window_end {
                progress.step(OpenPhase::Checking, self.i, self.bytes.len());
                self.window_end = ((self.i / TICK_BYTES + 1) * TICK_BYTES).min(self.bytes.len());
                if !ahead(self.window_end) {
                    return Err(Rejected);
                }
            }
            self.ws();
            match self.peek()? {
                b'{' => {
                    self.open(Frame::Object {
                        at: self.i,
                        keys_from: self.keys.len(),
                        escaped: false,
                    })?;
                    self.ws();
                    if self.peek()? == b'}' {
                        self.i += 1;
                        self.close_object()?;
                    } else {
                        self.key()?;
                        continue 'value;
                    }
                }
                b'[' => {
                    if self.stack.is_empty() {
                        self.root = Some(RootItems {
                            len: 0,
                            checkpoints: Vec::new(),
                        });
                    }
                    self.open(Frame::Array)?;
                    self.ws();
                    if self.peek()? == b']' {
                        self.i += 1;
                        self.stack.pop();
                    } else {
                        self.item()?;
                        continue 'value;
                    }
                }
                b'"' => {
                    self.string()?;
                }
                b't' => self.literal(b"true")?,
                b'f' => self.literal(b"false")?,
                b'n' => self.literal(b"null")?,
                b'-' | b'0'..=b'9' => self.number()?,
                _ => return Err(Rejected),
            }
            loop {
                self.ws();
                match self.stack.last() {
                    None if self.i == self.bytes.len() => {
                        progress.step(OpenPhase::Checking, self.i, self.bytes.len());
                        return Ok(());
                    }
                    None => return Err(Rejected),
                    Some(Frame::Array) => match self.peek()? {
                        b',' => {
                            self.i += 1;
                            self.ws();
                            self.item()?;
                            continue 'value;
                        }
                        b']' => {
                            self.i += 1;
                            self.stack.pop();
                        }
                        _ => return Err(Rejected),
                    },
                    Some(Frame::Object { .. }) => match self.peek()? {
                        b',' => {
                            self.i += 1;
                            self.ws();
                            self.key()?;
                            continue 'value;
                        }
                        b'}' => {
                            self.i += 1;
                            self.close_object()?;
                        }
                        _ => return Err(Rejected),
                    },
                }
            }
        }
    }

    fn peek(&self) -> Result<u8, Rejected> {
        self.bytes.get(self.i).copied().ok_or(Rejected)
    }

    fn ws(&mut self) {
        while matches!(self.bytes.get(self.i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn open(&mut self, frame: Frame) -> Step {
        if self.stack.len() == MAX_DEPTH as usize {
            return Err(Rejected);
        }
        self.stack.push(frame);
        self.i += 1;
        Ok(())
    }

    fn item(&mut self) -> Step {
        if let (Some(root), 1) = (&mut self.root, self.stack.len()) {
            if (root.len as usize).is_multiple_of(INDEX_STRIDE) {
                root.checkpoints.push(self.i as u64);
            }
            root.len = root.len.checked_add(1).ok_or(Rejected)?;
        }
        Ok(())
    }

    fn key(&mut self) -> Step {
        let start = self.i;
        if self.peek()? != b'"' {
            return Err(Rejected);
        }
        if self.string()? {
            if let Some(Frame::Object { escaped, .. }) = self.stack.last_mut() {
                *escaped = true;
            }
        }
        self.keys.push((start, self.i));
        self.ws();
        if self.peek()? != b':' {
            return Err(Rejected);
        }
        self.i += 1;
        Ok(())
    }

    fn close_object(&mut self) -> Step {
        let Some(Frame::Object {
            at,
            keys_from,
            escaped,
        }) = self.stack.pop()
        else {
            return Ok(());
        };
        let bytes = self.bytes;
        let own = &mut self.keys[keys_from..];
        let repeats = if escaped {
            let mut decoded = own
                .iter()
                .map(|&(s, e)| std::str::from_utf8(&bytes[s..e]).map(key_text))
                .collect::<Result<Vec<Cow<'_, str>>, _>>()
                .map_err(|_| Rejected)?;
            decoded.sort_unstable();
            decoded.windows(2).any(|w| w[0] == w[1])
        } else if own.len() <= 16 {
            let raw = |&(s, e): &(usize, usize)| &bytes[s..e];
            own.iter()
                .enumerate()
                .any(|(n, a)| own[n + 1..].iter().any(|b| raw(a) == raw(b)))
        } else {
            own.sort_unstable_by(|a, b| bytes[a.0..a.1].cmp(&bytes[b.0..b.1]));
            own.windows(2)
                .any(|w| bytes[w[0].0..w[0].1] == bytes[w[1].0..w[1].1])
        };
        if repeats {
            self.repeated.push(at);
        }
        self.keys.truncate(keys_from);
        Ok(())
    }

    fn string(&mut self) -> Result<bool, Rejected> {
        self.i += 1;
        let mut escaped = false;
        loop {
            while let Some(&word) = self.bytes.get(self.i..).and_then(|r| r.first_chunk::<8>()) {
                let stop = string_stop(u64::from_le_bytes(word));
                if stop != 0 {
                    self.i += stop.trailing_zeros() as usize / 8;
                    break;
                }
                self.i += 8;
            }
            match self.peek()? {
                b'"' => {
                    self.i += 1;
                    return Ok(escaped);
                }
                b'\\' => {
                    escaped = true;
                    self.escape()?;
                }
                b if b < 0x20 => return Err(Rejected),
                _ => self.i += 1,
            }
        }
    }

    fn escape(&mut self) -> Step {
        match self.bytes.get(self.i + 1) {
            Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => self.i += 2,
            Some(b'u') => {
                let hex = self.bytes.get(self.i + 2..self.i + 6).ok_or(Rejected)?;
                if !hex.iter().all(u8::is_ascii_hexdigit) {
                    return Err(Rejected);
                }
                if matches!(hex[0], b'd' | b'D')
                    && matches!(hex[1], b'8'..=b'9' | b'a'..=b'f' | b'A'..=b'F')
                {
                    self.surrogate = true;
                }
                self.i += 6;
            }
            _ => return Err(Rejected),
        }
        Ok(())
    }

    fn literal(&mut self, word: &[u8]) -> Step {
        if self.bytes.get(self.i..self.i + word.len()) != Some(word) {
            return Err(Rejected);
        }
        self.i += word.len();
        Ok(())
    }

    fn number(&mut self) -> Step {
        if self.peek()? == b'-' {
            self.i += 1;
        }
        match self.peek()? {
            b'0' => self.i += 1,
            b'1'..=b'9' => self.digits()?,
            _ => return Err(Rejected),
        }
        if self.bytes.get(self.i) == Some(&b'.') {
            self.i += 1;
            self.digits()?;
        }
        if matches!(self.bytes.get(self.i), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.bytes.get(self.i), Some(b'+' | b'-')) {
                self.i += 1;
            }
            self.digits()?;
        }
        Ok(())
    }

    fn digits(&mut self) -> Step {
        let start = self.i;
        while self.bytes.get(self.i).is_some_and(u8::is_ascii_digit) {
            self.i += 1;
        }
        if self.i == start {
            return Err(Rejected);
        }
        Ok(())
    }
}

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGHS: u64 = 0x8080_8080_8080_8080;

fn string_stop(word: u64) -> u64 {
    let zero_byte = |x: u64| x.wrapping_sub(ONES) & !x & HIGHS;
    zero_byte(word ^ (ONES * u64::from(b'"')))
        | zero_byte(word ^ (ONES * u64::from(b'\\')))
        | (word.wrapping_sub(ONES * 0x20) & !word & HIGHS)
}
