use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use specta_typescript::branded;

use super::types::{DocError, DocResult};

branded!(
    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct LosslessText(String)
);

impl LosslessText {
    pub fn from_value(v: &serde_json::Value) -> Self {
        Self(serde_json::to_string(v).expect("in-memory JSON serialization is infallible"))
    }

    pub fn from_value_pretty(v: &serde_json::Value) -> Self {
        Self(serde_json::to_string_pretty(v).expect("in-memory JSON serialization is infallible"))
    }

    pub fn from_raw(text: String) -> Self {
        Self(text)
    }

    #[allow(dead_code)]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parse(&self) -> DocResult<serde_json::Value> {
        serde_json::from_str(&self.0).map_err(|e| DocError::Parse(e.to_string()))
    }
}

pub fn cmp_number_tokens(a: &str, b: &str) -> Option<Ordering> {
    Some(Decimal::parse(a)?.cmp_exact(&Decimal::parse(b)?))
}

struct Decimal {
    neg: bool,
    digits: Vec<u8>,
    msd_exp: i64,
}

impl Decimal {
    fn parse(token: &str) -> Option<Self> {
        let s = token.trim();
        let mut bytes = s.bytes().peekable();

        let neg = match bytes.peek() {
            Some(b'-') => {
                bytes.next();
                true
            }
            Some(b'+') => {
                bytes.next();
                false
            }
            _ => false,
        };

        let mut int_len: i64 = 0;
        let mut combined: Vec<u8> = Vec::new();
        let mut saw_digit = false;
        let mut exp10: i64 = 0;

        while let Some(&c) = bytes.peek() {
            if c.is_ascii_digit() {
                combined.push(c - b'0');
                int_len += 1;
                saw_digit = true;
                bytes.next();
            } else {
                break;
            }
        }
        if bytes.peek() == Some(&b'.') {
            bytes.next();
            while let Some(&c) = bytes.peek() {
                if c.is_ascii_digit() {
                    combined.push(c - b'0');
                    saw_digit = true;
                    bytes.next();
                } else {
                    break;
                }
            }
        }
        if !saw_digit {
            return None;
        }
        if matches!(bytes.peek(), Some(b'e' | b'E')) {
            bytes.next();
            let mut exp_str = String::new();
            if matches!(bytes.peek(), Some(b'-' | b'+')) {
                exp_str.push(bytes.next().unwrap() as char);
            }
            while let Some(&c) = bytes.peek() {
                if c.is_ascii_digit() {
                    exp_str.push(c as char);
                    bytes.next();
                } else {
                    break;
                }
            }
            exp10 = exp_str.parse().ok()?;
        }
        if bytes.next().is_some() {
            return None;
        }

        let first_nonzero = combined.iter().position(|&d| d != 0);
        let (digits, msd_exp) = match first_nonzero {
            None => (Vec::new(), 0),
            Some(i) => {
                let last_nonzero = combined.iter().rposition(|&d| d != 0).unwrap();
                let msd_exp = (int_len - 1 - i as i64).checked_add(exp10)?;
                (combined[i..=last_nonzero].to_vec(), msd_exp)
            }
        };
        Some(Self {
            neg,
            digits,
            msd_exp,
        })
    }

    fn is_zero(&self) -> bool {
        self.digits.is_empty()
    }

    fn cmp_exact(&self, other: &Self) -> Ordering {
        match (self.is_zero(), other.is_zero()) {
            (true, true) => Ordering::Equal,
            (true, false) => {
                if other.neg {
                    Ordering::Greater
                } else {
                    Ordering::Less
                }
            }
            (false, true) => {
                if self.neg {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            }
            (false, false) => {
                if self.neg != other.neg {
                    return if self.neg {
                        Ordering::Less
                    } else {
                        Ordering::Greater
                    };
                }
                let magnitude = self
                    .msd_exp
                    .cmp(&other.msd_exp)
                    .then_with(|| cmp_digit_runs(&self.digits, &other.digits));
                if self.neg {
                    magnitude.reverse()
                } else {
                    magnitude
                }
            }
        }
    }
}

fn cmp_digit_runs(a: &[u8], b: &[u8]) -> Ordering {
    let len = a.len().max(b.len());
    for i in 0..len {
        let da = a.get(i).copied().unwrap_or(0);
        let db = b.get(i).copied().unwrap_or(0);
        match da.cmp(&db) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmp(a: &str, b: &str) -> Option<Ordering> {
        cmp_number_tokens(a, b)
    }

    #[test]
    fn equal_across_representations() {
        assert_eq!(cmp("1", "1.0"), Some(Ordering::Equal));
        assert_eq!(cmp("1", "1e0"), Some(Ordering::Equal));
        assert_eq!(cmp("1000", "1e3"), Some(Ordering::Equal));
        assert_eq!(cmp("0.5", "5e-1"), Some(Ordering::Equal));
        assert_eq!(cmp("0.5", "5E-1"), Some(Ordering::Equal));
        assert_eq!(cmp("100.00", "1e2"), Some(Ordering::Equal));
    }

    #[test]
    fn zero_forms_are_equal() {
        assert_eq!(cmp("0", "-0"), Some(Ordering::Equal));
        assert_eq!(cmp("0.0", "0"), Some(Ordering::Equal));
        assert_eq!(cmp("0e5", "0"), Some(Ordering::Equal));
        assert_eq!(cmp("-0.000", "0"), Some(Ordering::Equal));
    }

    #[test]
    fn big_integers_compare_exactly() {
        assert_eq!(
            cmp("1075283027435454464", "1075283027435454465"),
            Some(Ordering::Less)
        );
        assert_eq!(
            cmp("1075283027435454464", "1075283027435454464"),
            Some(Ordering::Equal)
        );
        assert_eq!(
            cmp("9007199254740993", "9007199254740992"),
            Some(Ordering::Greater)
        );
    }

    #[test]
    fn high_precision_fractions_compare_exactly() {
        assert_eq!(
            cmp("0.10000000000000000001", "0.1"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            cmp("3.141592653589793238462643", "3.141592653589793238462644"),
            Some(Ordering::Less)
        );
    }

    #[test]
    fn signs_and_magnitudes() {
        assert_eq!(cmp("-1", "1"), Some(Ordering::Less));
        assert_eq!(cmp("-1", "-2"), Some(Ordering::Greater));
        assert_eq!(cmp("-10", "-9.5"), Some(Ordering::Less));
        assert_eq!(cmp("2", "10"), Some(Ordering::Less));
        assert_eq!(cmp("-0.1", "0"), Some(Ordering::Less));
    }

    #[test]
    fn non_numbers_are_rejected() {
        assert_eq!(cmp("abc", "1"), None);
        assert_eq!(cmp("1", ""), None);
        assert_eq!(cmp("1.2.3", "1"), None);
        assert_eq!(cmp("1e", "1"), None);
        assert_eq!(cmp("inf", "1"), None);
        assert_eq!(cmp("NaN", "1"), None);
    }

    #[test]
    fn lossless_text_roundtrips_value() {
        let v: serde_json::Value = serde_json::from_str("[1075283027435454464, 1.5]").unwrap();
        let text = LosslessText::from_value(&v);
        assert_eq!(text.as_str(), "[1075283027435454464,1.5]");
        assert_eq!(text.parse().unwrap(), v);
    }

    #[test]
    fn lossless_text_serializes_transparently() {
        let t = LosslessText::from_raw("{\"a\":1}".into());
        assert_eq!(serde_json::to_string(&t).unwrap(), "\"{\\\"a\\\":1}\"");
    }
}
