
use std::fmt::Write as _;
use std::time::{Duration, Instant};

use super::document::Document;
use super::types::{NodeKind, Path, PathSegment};

struct Lcg(u64);
impl Lcg {
    fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }
    fn range(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }
}

const LEVELS: &[&str] = &["info", "warn", "error", "debug"];
const SERVICES: &[&str] = &[
    "api-gateway",
    "auth-service",
    "billing",
    "ingest-pipeline",
    "search-frontend",
];

fn write_record(out: &mut String, rng: &mut Lcg, id: u64) {
    let level = LEVELS[(rng.range(LEVELS.len() as u64)) as usize];
    let service = SERVICES[(rng.range(SERVICES.len() as u64)) as usize];
    let status = [200u32, 201, 204, 400, 401, 404, 500][(rng.range(7)) as usize];
    let duration = rng.range(2_000);
    let host_suffix = rng.next_u64();
    let trace = rng.next_u64() as u128 | ((rng.next_u64() as u128) << 64);
    let span = rng.next_u64();

    let _ = write!(
        out,
        r#"{{"id":{id},"timestamp":"2026-05-06T12:{mm:02}:{ss:02}.{ms:03}Z","level":"{level}","service":"{service}","host":"host-{host_suffix:016x}","message":"request handled successfully with no errors detected on this run","request":{{"method":"GET","path":"/api/v1/resources/{id}","status":{status},"duration_ms":{duration},"user_agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15"}},"tags":["prod","v1","baseline","{level}","{service}"],"metadata":{{"build":"abc123def","trace_id":"{trace:032x}","span_id":"{span:016x}"}}}}"#,
        mm = (id / 60) % 60,
        ss = id % 60,
        ms = id % 1000,
    );
}

fn build_fixture(n: usize) -> String {
    let mut out = String::with_capacity(n * 600);
    let mut rng = Lcg::new(0xC0FFEE);
    out.push('[');
    for i in 0..n {
        if i > 0 {
            out.push(',');
        }
        write_record(&mut out, &mut rng, i as u64);
    }
    out.push(']');
    out
}

fn fmt_ms(d: Duration) -> String {
    format!("{:.2} ms", d.as_secs_f64() * 1000.0)
}

fn fmt_mb(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

fn stats(samples: &mut [Duration]) -> (Duration, Duration) {
    samples.sort();
    let n = samples.len();
    (samples[n / 2], samples[(n * 99 / 100).min(n - 1)])
}

#[test]
#[ignore = "100MB fixture; run via --ignored"]
fn baseline_step_1_perf_gate() {
    println!();
    println!("==================================================================");
    println!("  baseline · 100 MB synthetic log · {}", chrono_ish_today());
    println!("==================================================================");

    let target_records = 200_000usize;
    let t0 = Instant::now();
    let json = build_fixture(target_records);
    let gen_time = t0.elapsed();
    let bytes = json.len();
    println!(
        "fixture: {} records, {} ({} to generate)",
        target_records,
        fmt_mb(bytes),
        fmt_ms(gen_time)
    );
    assert!(
        bytes >= 90 * 1024 * 1024,
        "fixture missed the 100 MB target: {}",
        fmt_mb(bytes)
    );

    let t0 = Instant::now();
    let doc = Document::from_text(&json, Some("synthetic-100mb.json".into()))
        .expect("synthetic JSON must be valid");
    let open_time = t0.elapsed();
    let summary = doc.summary();
    println!(
        "open:    {} (lazy={}, rootKind={:?}, rootChildCount={:?})",
        fmt_ms(open_time),
        summary.lazy,
        summary.root_kind,
        summary.root_child_count
    );
    assert!(summary.lazy, "100 MB doc must trigger the lazy path");
    assert_eq!(summary.root_kind, NodeKind::Array);

    println!("\n-- sequential slice latency (30 fetches per offset, range [N..N+50]) --");
    let n = target_records as u32;
    let offsets: Vec<u32> = vec![0, 1_000, 10_000, 50_000, n.saturating_sub(1_000)]
        .into_iter()
        .filter(|o| *o + 50 <= n)
        .collect();

    for &off in &offsets {
        let mut samples = Vec::with_capacity(30);
        for _ in 0..30 {
            let t = Instant::now();
            let slice = doc
                .get_slice(&Path::root(), off..(off + 50))
                .expect("slice must succeed");
            assert!(!slice.is_empty(), "slice at offset {} was empty", off);
            samples.push(t.elapsed());
        }
        let (median, p99) = stats(&mut samples);
        println!(
            "  offset {:>6}: median {}, p99 {}",
            off,
            fmt_ms(median),
            fmt_ms(p99)
        );
    }

    println!("\n-- random-access slice latency (60 LCG-shuffled offsets) --");
    let mut rng = Lcg::new(0xBEEF);
    let mut samples = Vec::with_capacity(60);
    let max_off = n.saturating_sub(50);
    for _ in 0..60 {
        let off = rng.range(max_off as u64) as u32;
        let t = Instant::now();
        let _ = doc
            .get_slice(&Path::root(), off..(off + 50))
            .expect("slice must succeed");
        samples.push(t.elapsed());
    }
    let (median, p99) = stats(&mut samples);
    println!("  random: median {}, p99 {}", fmt_ms(median), fmt_ms(p99));

    let gate_threshold = Duration::from_millis(30);
    let gate_status = if median > gate_threshold {
        "FAIL → schedule slice-cache work for v1.x"
    } else {
        "PASS → ship without cache; revisit only if real workloads regress"
    };
    println!(
        "  gate (median ≤ 30 ms): {} ({})",
        gate_status,
        fmt_ms(median)
    );

    println!("\n-- repeated-path latency (same offset 30 times) --");
    let mut samples = Vec::with_capacity(30);
    for _ in 0..30 {
        let t = Instant::now();
        let _ = doc
            .get_slice(&Path::root(), 50_000..50_050)
            .expect("slice must succeed");
        samples.push(t.elapsed());
    }
    let (median, p99) = stats(&mut samples);
    println!(
        "  repeat 50000: median {}, p99 {}",
        fmt_ms(median),
        fmt_ms(p99)
    );

    println!("\n-- property-style invariants (500 random paths, fixed seed) --");
    let mut rng = Lcg::new(0x5EED);
    let mut object_slices = 0u32;
    let mut array_slices = 0u32;
    let mut empty_slices = 0u32;

    for _ in 0..500 {
        let i = rng.range(target_records as u64) as u32;
        let path = match rng.range(3) {
            0 => Path(vec![PathSegment::Index(i)]),
            1 => Path(vec![
                PathSegment::Index(i),
                PathSegment::Key("request".into()),
            ]),
            _ => Path(vec![
                PathSegment::Index(i),
                PathSegment::Key("metadata".into()),
            ]),
        };

        let slice = doc
            .get_slice(&path, 0..1_000)
            .expect("slice on a known-good path must succeed");

        let mut last_index: Option<u32> = None;
        let mut seen_keys: std::collections::HashSet<String> = Default::default();
        for nv in &slice {
            assert!(!nv.preview.is_empty(), "preview empty for {:?}", nv);
            match nv.kind {
                NodeKind::String | NodeKind::Number | NodeKind::Bool | NodeKind::Null => {
                    assert!(nv.child_count.is_none(), "primitive child_count: {:?}", nv);
                }
                NodeKind::Object | NodeKind::Array => {}
            }
            match &nv.key {
                PathSegment::Index(j) => {
                    if let Some(prev) = last_index {
                        assert!(*j > prev, "array indices must ascend: {} after {}", j, prev);
                    }
                    last_index = Some(*j);
                }
                PathSegment::Key(k) => {
                    assert!(seen_keys.insert(k.clone()), "duplicate key in slice: {}", k);
                }
            }
        }

        match slice.first().map(|nv| &nv.key) {
            Some(PathSegment::Key(_)) => object_slices += 1,
            Some(PathSegment::Index(_)) => array_slices += 1,
            None => empty_slices += 1,
        }
    }
    println!(
        "  500 probes ok · {} object · {} array · {} empty",
        object_slices, array_slices, empty_slices
    );

    println!("\n==================================================================");
}

fn chrono_ish_today() -> &'static str {
    "run with --nocapture to see numbers"
}
