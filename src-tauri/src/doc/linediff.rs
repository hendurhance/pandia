use imara_diff::{Algorithm, Diff, InternedInput};
use serde::Serialize;

use super::jobs::CancelFlag;
use super::types::{DocError, DocResult};

pub const LINE_FETCH_MAX: u32 = 5_000;

const CANCEL_CHECK_MASK: u32 = 0x0FFF;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineHunk {
    pub left_start: u32,
    pub left_len: u32,
    pub right_start: u32,
    pub right_len: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineDiffResult {
    pub hunks: Vec<LineHunk>,
    pub left_lines: u32,
    pub right_lines: u32,
}

pub fn compute_line_diff(
    left: &str,
    right: &str,
    cancel: &CancelFlag,
) -> DocResult<LineDiffResult> {
    let input = InternedInput::new(left, right);
    if cancel.is_cancelled() {
        return Err(DocError::Cancelled);
    }
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    diff.postprocess_lines(&input);

    let mut hunks = Vec::new();
    for hunk in diff.hunks() {
        if hunks.len() as u32 & CANCEL_CHECK_MASK == 0 && cancel.is_cancelled() {
            return Err(DocError::Cancelled);
        }
        hunks.push(LineHunk {
            left_start: hunk.before.start,
            left_len: hunk.before.end - hunk.before.start,
            right_start: hunk.after.start,
            right_len: hunk.after.end - hunk.after.start,
        });
    }
    Ok(LineDiffResult {
        hunks,
        left_lines: input.before.len() as u32,
        right_lines: input.after.len() as u32,
    })
}

pub fn line_starts(text: &str) -> Vec<u32> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut starts = vec![0u32];
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' && i + 1 < text.len() {
            starts.push((i + 1) as u32);
        }
    }
    starts
}

pub fn line_slice(text: &str, starts: &[u32], range: std::ops::Range<u32>) -> Vec<String> {
    let total = starts.len() as u32;
    let start = range.start.min(total);
    let end = range.end.min(total);
    let mut out = Vec::with_capacity(end.saturating_sub(start) as usize);
    for i in start..end {
        let from = starts[i as usize] as usize;
        let to = match starts.get(i as usize + 1) {
            Some(&next) => next as usize,
            None => text.len(),
        };
        let line = &text[from..to];
        out.push(line.strip_suffix('\n').unwrap_or(line).to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diff(l: &str, r: &str) -> LineDiffResult {
        compute_line_diff(l, r, &CancelFlag::never()).expect("never cancelled")
    }

    fn hunk(left_start: u32, left_len: u32, right_start: u32, right_len: u32) -> LineHunk {
        LineHunk {
            left_start,
            left_len,
            right_start,
            right_len,
        }
    }

    fn changed(d: &LineDiffResult) -> (u32, u32) {
        d.hunks.iter().fold((0, 0), |(dels, adds), h| {
            (dels + h.left_len, adds + h.right_len)
        })
    }

    #[test]
    fn identical_text_produces_no_hunks() {
        let d = diff("a\nb\nc", "a\nb\nc");
        assert!(d.hunks.is_empty());
        assert_eq!(d.left_lines, 3);
        assert_eq!(d.right_lines, 3);
    }

    #[test]
    fn single_line_replace_is_one_hunk() {
        let d = diff("a\nb\nc", "a\nX\nc");
        assert_eq!(d.hunks, vec![hunk(1, 1, 1, 1)]);
    }

    #[test]
    fn pure_insertion_keeps_surrounding_context() {
        let d = diff("a\nc", "a\nb\nc");
        assert_eq!(d.hunks, vec![hunk(1, 0, 1, 1)]);
        assert_eq!(d.left_lines, 2);
        assert_eq!(d.right_lines, 3);
    }

    #[test]
    fn pure_deletion_keeps_surrounding_context() {
        let d = diff("a\nb\nc", "a\nc");
        assert_eq!(d.hunks, vec![hunk(1, 1, 1, 0)]);
    }

    #[test]
    fn scattered_changes_emit_separate_hunks() {
        let d = diff("X\nb\nc\nd\nY\nf", "A\nb\nc\nd\nB\nf");
        assert_eq!(d.hunks, vec![hunk(0, 1, 0, 1), hunk(4, 1, 4, 1)]);
    }

    #[test]
    fn one_side_empty_is_a_single_hunk() {
        let d = diff("", "a\nb\nc");
        assert_eq!(d.left_lines, 0);
        assert_eq!(d.hunks, vec![hunk(0, 0, 0, 3)]);

        let d = diff("a\nb\nc", "");
        assert_eq!(d.right_lines, 0);
        assert_eq!(d.hunks, vec![hunk(0, 3, 0, 0)]);
    }

    #[test]
    fn single_line_documents_diff_as_replace() {
        let d = diff("alpha", "beta");
        assert_eq!(d.left_lines, 1);
        assert_eq!(d.right_lines, 1);
        assert_eq!(d.hunks, vec![hunk(0, 1, 0, 1)]);
    }

    #[test]
    fn minified_single_line_pair_reports_one_line_changed() {
        let left = r#"{"a":1,"b":[1,2,3],"c":{"d":"x"}}"#;
        let right = r#"{"a":2,"b":[1,2,3],"c":{"d":"y"}}"#;
        let d = diff(left, right);
        assert_eq!(d.left_lines, 1);
        assert_eq!(d.right_lines, 1);
        assert_eq!(d.hunks, vec![hunk(0, 1, 0, 1)]);
    }

    #[test]
    fn scattered_edits_report_correct_small_counts() {
        let left: Vec<String> = (0..6000).map(|i| format!("  \"key-{i}\": {i},")).collect();
        let mut right = left.clone();
        for k in 0..12 {
            right[250 + k * 500] = format!("  \"key-{k}\": \"edited\",");
        }
        let d = diff(&left.join("\n"), &right.join("\n"));
        assert_eq!(d.left_lines, 6000);
        assert_eq!(d.right_lines, 6000);
        assert_eq!(d.hunks.len(), 12);
        assert_eq!(changed(&d), (12, 12));
    }

    #[test]
    fn cancelled_flag_aborts() {
        let flag = CancelFlag::never();
        flag.cancel();
        assert!(matches!(
            compute_line_diff("a", "b", &flag),
            Err(DocError::Cancelled)
        ));
    }

    #[test]
    fn line_starts_matches_imara_tokenisation() {
        for text in ["", "a", "a\n", "a\nb", "a\nb\n", "\n", "\n\n", "{}"] {
            let starts = line_starts(text);
            let input = InternedInput::new(text, "");
            assert_eq!(starts.len(), input.before.len(), "{text:?}");
        }
    }

    #[test]
    fn line_slice_pages_by_range_and_clamps() {
        let text = "a\nbb\nccc";
        let starts = line_starts(text);
        assert_eq!(line_slice(text, &starts, 0..3), vec!["a", "bb", "ccc"]);
        assert_eq!(line_slice(text, &starts, 1..2), vec!["bb"]);
        assert_eq!(line_slice(text, &starts, 2..99), vec!["ccc"]);
        assert!(line_slice(text, &starts, 5..9).is_empty());
    }

    #[test]
    fn hunk_ranges_index_into_sliced_lines() {
        let left = "a\nb\nc\nd";
        let right = "a\nB\nc\nd";
        let d = diff(left, right);
        let h = d.hunks[0];
        let l_starts = line_starts(left);
        let r_starts = line_starts(right);
        assert_eq!(
            line_slice(left, &l_starts, h.left_start..h.left_start + h.left_len),
            vec!["b"]
        );
        assert_eq!(
            line_slice(right, &r_starts, h.right_start..h.right_start + h.right_len),
            vec!["B"]
        );
    }
}
