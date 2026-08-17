mod alloc_track;
mod candidates;
mod child;
mod fixtures;
mod orchestrate;
mod prng;

use std::path::PathBuf;
use std::process::exit;

pub fn bench_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bench")
}

pub fn criterion_home() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/criterion")
}

fn main() {
    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a != "--bench")
        .collect();

    match args.first().map(String::as_str) {
        Some("gen") => fixtures::generate_all(),
        Some("run-one") => {
            if args.len() != 3 {
                eprintln!("usage: json_linediff run-one <impl> <fixture>");
                exit(2);
            }
            child::run(&args[1], &args[2]);
        }
        None | Some("run") => orchestrate::run_all(),
        Some(other) => {
            eprintln!(
                "unknown mode `{other}`; expected `gen`, `run`, or `run-one <impl> <fixture>`"
            );
            exit(2);
        }
    }
}
