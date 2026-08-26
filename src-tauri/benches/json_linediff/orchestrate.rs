use std::fs;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::bench_root;
use crate::candidates::IMPLS;
use crate::child::RESULT_MARKER;
use crate::fixtures::{self, ManifestEntry};

const DEFAULT_TIMEOUT_SECS: u64 = 90;
const DEFAULT_MAX_RSS_MB: u64 = 3_072;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "impl")]
    impl_id: String,
    fixture: String,
    median_ms: Option<f64>,
    peak_heap_bytes: Option<u64>,
    hunks: Option<u64>,
    changed_lines: Option<u64>,
    quality: &'static str,
}

enum ChildOutcome {
    Done {
        median_ms: f64,
        peak_heap_bytes: u64,
        hunks: u64,
        changed_lines: u64,
    },
    DidNotFinish(&'static str),
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

pub fn run_all() {
    if !bench_root().join("fixtures/manifest.json").exists() {
        eprintln!("no fixtures found, generating first...");
        fixtures::generate_all();
    }
    let manifest = fixtures::load_manifest();
    let timeout = Duration::from_secs(env_u64("PANDIA_BENCH_TIMEOUT_SECS", DEFAULT_TIMEOUT_SECS));
    let rss_cap_kb = env_u64("PANDIA_BENCH_MAX_RSS_MB", DEFAULT_MAX_RSS_MB) * 1024;
    let exe = std::env::current_exe().expect("current_exe");

    let mut records = Vec::new();
    let total = manifest.len() * IMPLS.len();
    let mut done = 0;
    for entry in &manifest {
        for impl_id in IMPLS {
            done += 1;
            eprint!("[{done}/{total}] {impl_id} on {} ... ", entry.name);
            let outcome = run_child(&exe, impl_id, &entry.name, timeout, rss_cap_kb);
            let record = match outcome {
                ChildOutcome::Done {
                    median_ms,
                    peak_heap_bytes,
                    hunks,
                    changed_lines,
                } => {
                    let quality = verdict(entry, changed_lines);
                    eprintln!("{median_ms:.1} ms, {changed_lines} changed, {quality}");
                    Record {
                        impl_id: impl_id.to_string(),
                        fixture: entry.name.clone(),
                        median_ms: Some(median_ms),
                        peak_heap_bytes: Some(peak_heap_bytes),
                        hunks: Some(hunks),
                        changed_lines: Some(changed_lines),
                        quality,
                    }
                }
                ChildOutcome::DidNotFinish(reason) => {
                    eprintln!("timeout ({reason})");
                    Record {
                        impl_id: impl_id.to_string(),
                        fixture: entry.name.clone(),
                        median_ms: None,
                        peak_heap_bytes: None,
                        hunks: None,
                        changed_lines: None,
                        quality: "timeout",
                    }
                }
            };
            records.push(record);
        }
    }

    let results_dir = bench_root().join("results");
    fs::create_dir_all(&results_dir).expect("create bench/results");
    let out_path = results_dir.join("rust-diff.json");
    fs::write(&out_path, serde_json::to_string_pretty(&records).unwrap()).expect("write results");

    print_table(&manifest, &records);
    println!("\nresults written to {}", out_path.display());
}

fn verdict(entry: &ManifestEntry, changed: u64) -> &'static str {
    let expected = entry.expected_changed_lines;
    let total = entry.left_lines + entry.right_lines;
    if changed as f64 >= 0.9 * total as f64 && (expected as f64) < 0.5 * total as f64 {
        return "fake";
    }
    let tol = (expected / 10).max(10);
    if changed + tol >= expected && changed <= expected + tol {
        "ok"
    } else {
        "degraded"
    }
}

fn run_child(
    exe: &std::path::Path,
    impl_id: &str,
    fixture: &str,
    timeout: Duration,
    rss_cap_kb: u64,
) -> ChildOutcome {
    let mut cmd = Command::new(exe);
    cmd.args(["run-one", impl_id, fixture])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut chd = cmd.spawn().expect("spawn child");

    let mut stdout = chd.stdout.take().expect("child stdout");
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        buf
    });

    let started = Instant::now();
    let mut last_rss_check = Instant::now();
    let status = loop {
        if let Some(status) = chd.try_wait().expect("try_wait") {
            break Some(status);
        }
        if started.elapsed() > timeout {
            let _ = chd.kill();
            let _ = chd.wait();
            break None;
        }
        if last_rss_check.elapsed() > Duration::from_millis(500) {
            last_rss_check = Instant::now();
            if rss_kb(chd.id()) > rss_cap_kb {
                let _ = chd.kill();
                let _ = chd.wait();
                let _ = reader.join();
                return ChildOutcome::DidNotFinish("rss cap exceeded");
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let out = reader.join().unwrap_or_default();

    let Some(status) = status else {
        return ChildOutcome::DidNotFinish("wall clock");
    };
    if !status.success() {
        return ChildOutcome::DidNotFinish("child crashed");
    }
    let Some(line) = out.lines().find_map(|l| l.strip_prefix(RESULT_MARKER)) else {
        return ChildOutcome::DidNotFinish("no result emitted");
    };
    let v: Value = serde_json::from_str(line).expect("parse child record");
    ChildOutcome::Done {
        median_ms: v["medianMs"].as_f64().expect("medianMs"),
        peak_heap_bytes: v["peakHeapBytes"].as_u64().expect("peakHeapBytes"),
        hunks: v["hunks"].as_u64().expect("hunks"),
        changed_lines: v["changedLines"].as_u64().expect("changedLines"),
    }
}

fn rss_kb(pid: u32) -> u64 {
    let out = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse()
            .unwrap_or(0),
        Err(_) => 0,
    }
}

fn fmt_ms(v: Option<f64>) -> String {
    match v {
        Some(ms) if ms >= 1000.0 => format!("{:.2} s", ms / 1000.0),
        Some(ms) if ms >= 1.0 => format!("{ms:.1} ms"),
        Some(ms) => format!("{ms:.3} ms"),
        None => "-".to_string(),
    }
}

fn fmt_bytes(v: Option<u64>) -> String {
    match v {
        Some(b) if b >= 1_048_576 => format!("{:.1} MB", b as f64 / 1_048_576.0),
        Some(b) if b >= 1024 => format!("{:.1} KB", b as f64 / 1024.0),
        Some(b) => format!("{b} B"),
        None => "-".to_string(),
    }
}

fn fmt_opt(v: Option<u64>) -> String {
    v.map(|x| x.to_string()).unwrap_or_else(|| "-".to_string())
}

fn print_table(manifest: &[ManifestEntry], records: &[Record]) {
    for entry in manifest {
        let cap = if entry.lcs_cells > 4_000_000 {
            " (>4M JS cap)"
        } else {
            ""
        };
        println!(
            "\n{}  [{}]  {} x {} lines | lcsCells {}{} | expected changed {} | {}",
            entry.name,
            entry.shape,
            entry.left_lines,
            entry.right_lines,
            entry.lcs_cells,
            cap,
            entry.expected_changed_lines,
            entry.edit_pattern
        );
        println!(
            "  {:<24} {:>10} {:>10} {:>8} {:>9}   {}",
            "impl", "median", "peak heap", "hunks", "changed", "quality"
        );
        for r in records.iter().filter(|r| r.fixture == entry.name) {
            println!(
                "  {:<24} {:>10} {:>10} {:>8} {:>9}   {}",
                r.impl_id,
                fmt_ms(r.median_ms),
                fmt_bytes(r.peak_heap_bytes),
                fmt_opt(r.hunks),
                fmt_opt(r.changed_lines),
                r.quality
            );
        }
    }
}
