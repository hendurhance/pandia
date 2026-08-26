use std::fs;
use std::hint::black_box;
use std::time::{Duration, Instant};

use criterion::Criterion;
use serde_json::{json, Value};

use crate::candidates::run_diff;
use crate::{alloc_track, bench_root, criterion_home};

pub const RESULT_MARKER: &str = "PANDIA_BENCH_RESULT ";

const CRITERION_MAX_PROBE_MS: f64 = 1_500.0;
const MANUAL_MAX_PROBE_MS: f64 = 15_000.0;

pub fn run(impl_id: &str, fixture: &str) {
    std::env::set_var("CRITERION_HOME", criterion_home());

    let dir = bench_root().join("fixtures");
    let left =
        fs::read_to_string(dir.join(format!("{fixture}.left.json"))).expect("read left fixture");
    let right =
        fs::read_to_string(dir.join(format!("{fixture}.right.json"))).expect("read right fixture");

    alloc_track::reset_peak();
    let baseline = alloc_track::current();
    let t0 = Instant::now();
    let outcome = run_diff(impl_id, &left, &right);
    let probe_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let peak_heap = alloc_track::peak().saturating_sub(baseline);

    let median_ms = if probe_ms <= CRITERION_MAX_PROBE_MS {
        criterion_median_ms(impl_id, fixture, &left, &right).unwrap_or(probe_ms)
    } else if probe_ms <= MANUAL_MAX_PROBE_MS {
        let mut times = vec![
            probe_ms,
            timed_run_ms(impl_id, &left, &right),
            timed_run_ms(impl_id, &left, &right),
        ];
        times.sort_by(f64::total_cmp);
        times[1]
    } else {
        probe_ms
    };

    let record = json!({
        "impl": impl_id,
        "fixture": fixture,
        "medianMs": median_ms,
        "peakHeapBytes": peak_heap,
        "hunks": outcome.hunks,
        "changedLines": outcome.changed_lines(),
    });
    println!("{RESULT_MARKER}{record}");
}

fn timed_run_ms(impl_id: &str, left: &str, right: &str) -> f64 {
    let t0 = Instant::now();
    black_box(run_diff(impl_id, black_box(left), black_box(right)));
    t0.elapsed().as_secs_f64() * 1000.0
}

fn criterion_median_ms(impl_id: &str, fixture: &str, left: &str, right: &str) -> Option<f64> {
    let id = format!("{}__{}", impl_id.trim_start_matches("rust/"), fixture);
    let mut c = Criterion::default()
        .without_plots()
        .sample_size(10)
        .warm_up_time(Duration::from_millis(300))
        .measurement_time(Duration::from_millis(1_500));
    c.bench_function(&id, |b| {
        b.iter(|| black_box(run_diff(impl_id, black_box(left), black_box(right))))
    });
    c.final_summary();

    let path = criterion_home().join(&id).join("new/estimates.json");
    let text = fs::read_to_string(&path).ok()?;
    let est: Value = serde_json::from_str(&text).ok()?;
    let ns = est.get("median")?.get("point_estimate")?.as_f64()?;
    Some(ns / 1e6)
}
