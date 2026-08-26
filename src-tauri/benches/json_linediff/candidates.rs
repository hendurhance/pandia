use imara_diff::{Algorithm as ImaraAlgorithm, Diff, InternedInput};
use similar::{Algorithm as SimilarAlgorithm, DiffOp, TextDiff};

pub const IMPLS: &[&str] = &[
    "rust/imara-histogram",
    "rust/imara-myers",
    "rust/similar-myers",
    "rust/similar-patience",
    "rust/similar-lcs",
];

pub struct Outcome {
    pub hunks: u64,
    pub dels: u64,
    pub adds: u64,
}

impl Outcome {
    pub fn changed_lines(&self) -> u64 {
        self.dels + self.adds
    }
}

pub fn run_diff(impl_id: &str, left: &str, right: &str) -> Outcome {
    match impl_id {
        "rust/imara-histogram" => imara(ImaraAlgorithm::Histogram, left, right),
        "rust/imara-myers" => imara(ImaraAlgorithm::Myers, left, right),
        "rust/similar-myers" => sim(SimilarAlgorithm::Myers, left, right),
        "rust/similar-patience" => sim(SimilarAlgorithm::Patience, left, right),
        "rust/similar-lcs" => sim(SimilarAlgorithm::Lcs, left, right),
        other => panic!("unknown impl `{other}`"),
    }
}

fn imara(alg: ImaraAlgorithm, left: &str, right: &str) -> Outcome {
    let input = InternedInput::new(left, right);
    let diff = Diff::compute(alg, &input);
    Outcome {
        hunks: diff.hunks().count() as u64,
        dels: diff.count_removals() as u64,
        adds: diff.count_additions() as u64,
    }
}

fn sim(alg: SimilarAlgorithm, left: &str, right: &str) -> Outcome {
    let diff = TextDiff::configure().algorithm(alg).diff_lines(left, right);
    let mut out = Outcome {
        hunks: 0,
        dels: 0,
        adds: 0,
    };
    let mut in_hunk = false;
    for op in diff.ops() {
        match *op {
            DiffOp::Equal { .. } => in_hunk = false,
            DiffOp::Delete { old_len, .. } => {
                if !in_hunk {
                    out.hunks += 1;
                    in_hunk = true;
                }
                out.dels += old_len as u64;
            }
            DiffOp::Insert { new_len, .. } => {
                if !in_hunk {
                    out.hunks += 1;
                    in_hunk = true;
                }
                out.adds += new_len as u64;
            }
            DiffOp::Replace {
                old_len, new_len, ..
            } => {
                if !in_hunk {
                    out.hunks += 1;
                    in_hunk = true;
                }
                out.dels += old_len as u64;
                out.adds += new_len as u64;
            }
        }
    }
    out
}
