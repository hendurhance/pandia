use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::bench_root;
use crate::prng::{seed_for, Rng};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub name: String,
    pub shape: String,
    pub left_lines: u64,
    pub right_lines: u64,
    pub left_bytes: u64,
    pub right_bytes: u64,
    pub edit_pattern: String,
    pub expected_changed_lines: u64,
    pub lcs_cells: u64,
}

const LEVELS: &[&str] = &["debug", "info", "warn", "error"];
const REGIONS: &[&str] = &[
    "us-east-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-southeast-2",
    "sa-east-1",
];
const WORDS: &[&str] = &[
    "request",
    "completed",
    "retry",
    "queued",
    "cache",
    "miss",
    "upstream",
    "socket",
    "closed",
    "payload",
    "parsed",
    "schema",
    "valid",
    "worker",
    "spawned",
    "batch",
    "flushed",
    "index",
    "rebuilt",
    "session",
    "expired",
    "token",
    "refresh",
    "handler",
    "timeout",
    "replica",
    "elected",
    "snapshot",
    "stored",
    "stream",
    "resumed",
    "checksum",
];
const TAGS: &[&str] = &[
    "ingest", "api", "auth", "billing", "search", "sync", "export", "audit", "cron", "webhook",
];

fn record(rng: &mut Rng, id: u64) -> Value {
    let ts = format!(
        "2025-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        1 + rng.below(12),
        1 + rng.below(28),
        rng.below(24),
        rng.below(60),
        rng.below(60),
        rng.below(1000)
    );
    let level = *rng.pick(LEVELS);
    let word_count = 3 + rng.below(5);
    let words: Vec<&str> = (0..word_count).map(|_| *rng.pick(WORDS)).collect();
    let message = format!("{} #{}", words.join(" "), rng.below(100_000));
    let host = format!("srv-{:03}", rng.below(200));
    let region = *rng.pick(REGIONS);
    let attempt = 1 + rng.below(3);
    let latency = rng.below(5000);
    let tag_count = 1 + rng.below(3);
    let tags: Vec<Value> = (0..tag_count).map(|_| json!(*rng.pick(TAGS))).collect();
    json!({
        "id": id,
        "ts": ts,
        "level": level,
        "message": message,
        "meta": {
            "host": host,
            "region": region,
            "attempt": attempt,
            "latencyMs": latency,
        },
        "tags": tags,
    })
}

fn bump_scalar(v: &mut Value) {
    match v {
        Value::String(s) => s.push_str("-x"),
        Value::Bool(b) => *b = !*b,
        Value::Number(n) => {
            let bumped = n.as_u64().map(|x| x + 1).unwrap_or(1);
            *v = json!(bumped);
        }
        _ => panic!("bump_scalar called on non-scalar"),
    }
}

fn rewrite_record(rng: &mut Rng, rec: &mut Value) {
    let obj = rec.as_object_mut().unwrap();
    let id = obj["id"].as_u64().unwrap();
    let fresh = record(rng, id + 1_000_000);
    let keep_tags_len = obj["tags"].as_array().unwrap().len();
    for key in ["ts", "level", "message", "meta"] {
        obj[key] = fresh[key].clone();
    }
    let tags = obj["tags"].as_array_mut().unwrap();
    for t in tags.iter_mut() {
        bump_scalar(t);
    }
    debug_assert_eq!(tags.len(), keep_tags_len);
}

fn scatter_edit(rng: &mut Rng, rec: &mut Value, k: u64) {
    let obj = rec.as_object_mut().unwrap();
    match k % 4 {
        0 => bump_scalar(&mut obj["message"]),
        1 => bump_scalar(&mut obj["meta"]["latencyMs"]),
        2 => bump_scalar(&mut obj["meta"]["host"]),
        _ => {
            let tags = obj["tags"].as_array_mut().unwrap();
            let i = rng.below(tags.len() as u64) as usize;
            bump_scalar(&mut tags[i]);
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Pattern {
    Single,
    Scattered,
    Block,
    Heavy,
}

fn build_array_pair(name: &str, n: u64, pattern: Pattern) -> (Value, Value, String) {
    let mut rng = Rng::new(seed_for(name));
    let records: Vec<Value> = (0..n).map(|i| record(&mut rng, i)).collect();
    let left = Value::Array(records);
    let mut right = left.clone();
    let mut erng = Rng::new(seed_for(name) ^ 0xE017);
    let arr = right.as_array_mut().unwrap();

    let desc = match pattern {
        Pattern::Single => {
            let idx = (n * 3 / 5) as usize;
            bump_scalar(&mut arr[idx]["meta"]["latencyMs"]);
            format!("one scalar changed in element {idx} of {n}")
        }
        Pattern::Scattered => {
            for k in 0..12u64 {
                let idx = ((2 * k + 1) * n / 24) as usize;
                scatter_edit(&mut erng, &mut arr[idx], k);
            }
            "12 single-scalar edits spread evenly".to_string()
        }
        Pattern::Block => {
            let at = (n * 3 / 5) as usize;
            let inserted: Vec<Value> = (0..200).map(|i| record(&mut erng, n + i)).collect();
            arr.splice(at..at, inserted);
            format!("200 new elements inserted contiguously at index {at}")
        }
        Pattern::Heavy => {
            let mut touched = 0u64;
            for rec in arr.iter_mut() {
                if erng.chance(50) {
                    rewrite_record(&mut erng, rec);
                    touched += 1;
                }
            }
            format!("~30% of lines changed ({touched} of {n} elements rewritten)")
        }
    };
    (left, right, desc)
}

fn service(rng: &mut Rng, i: u64) -> Value {
    let env_keys = [
        "LOG_LEVEL",
        "DB_URL",
        "CACHE_TTL",
        "QUEUE",
        "FEATURE_SET",
        "POOL_SIZE",
    ];
    let mut env = Map::new();
    for k in env_keys {
        env.insert(
            k.to_string(),
            json!(format!("{}-{}", k.to_lowercase(), rng.below(1000))),
        );
    }
    json!({
        "image": format!("registry.local/app-{i}:{}.{}.{}", 1 + rng.below(4), rng.below(20), rng.below(50)),
        "replicas": 1 + rng.below(8),
        "enabled": rng.chance(85),
        "env": env,
        "resources": {
            "limits": { "cpu": format!("{}m", 100 * (1 + rng.below(20))), "memory": format!("{}Mi", 64 * (1 + rng.below(32))) },
            "requests": { "cpu": format!("{}m", 50 * (1 + rng.below(10))), "memory": format!("{}Mi", 32 * (1 + rng.below(16))) },
        },
        "ports": [ json!(3000 + rng.below(5000)), json!(9000 + rng.below(1000)) ],
        "labels": {
            "team": *rng.pick(&["core", "data", "infra", "growth"]),
            "tier": *rng.pick(&["frontend", "backend", "batch"]),
            "region": *rng.pick(REGIONS),
        },
        "healthcheck": {
            "path": format!("/healthz/{}", rng.below(100)),
            "intervalSeconds": 5 + rng.below(55),
            "timeoutSeconds": 1 + rng.below(9),
        },
    })
}

fn config_doc(rng: &mut Rng, services: u64) -> Value {
    let mut svc = Map::new();
    for i in 0..services {
        svc.insert(format!("svc-{i:04}"), service(rng, i));
    }
    let mut features = Map::new();
    for i in 0..8 {
        features.insert(format!("flag-{i}"), json!(rng.chance(50)));
    }
    json!({
        "name": "pandia-bench-config",
        "version": format!("{}.{}.{}", 1 + rng.below(3), rng.below(10), rng.below(20)),
        "services": Value::Object(svc),
        "features": Value::Object(features),
        "logging": {
            "level": *rng.pick(LEVELS),
            "format": "json",
            "sinks": [ "stdout", "file" ],
            "rotation": { "maxSizeMb": 50 + rng.below(200), "keep": 1 + rng.below(10) },
        },
    })
}

#[derive(Clone)]
enum Step {
    Key(String),
    Idx(usize),
}

fn collect_scalar_paths(v: &Value, prefix: &mut Vec<Step>, out: &mut Vec<Vec<Step>>) {
    match v {
        Value::Object(m) => {
            for (k, child) in m {
                prefix.push(Step::Key(k.clone()));
                collect_scalar_paths(child, prefix, out);
                prefix.pop();
            }
        }
        Value::Array(a) => {
            for (i, child) in a.iter().enumerate() {
                prefix.push(Step::Idx(i));
                collect_scalar_paths(child, prefix, out);
                prefix.pop();
            }
        }
        _ => out.push(prefix.clone()),
    }
}

fn resolve_mut<'a>(root: &'a mut Value, path: &[Step]) -> &'a mut Value {
    let mut cur = root;
    for step in path {
        cur = match step {
            Step::Key(k) => &mut cur[k.as_str()],
            Step::Idx(i) => &mut cur[*i],
        };
    }
    cur
}

fn insert_key_mid(obj: &mut Map<String, Value>, key: String, val: Value) {
    let at = obj.len() / 2;
    let mut rebuilt = Map::new();
    for (i, (k, v)) in std::mem::take(obj).into_iter().enumerate() {
        if i == at {
            rebuilt.insert(key.clone(), val.clone());
        }
        rebuilt.insert(k, v);
    }
    if at >= rebuilt.len() {
        rebuilt.insert(key, val);
    }
    *obj = rebuilt;
}

fn build_config_pair(name: &str, services: u64, pattern: Pattern) -> (Value, Value, String) {
    let mut rng = Rng::new(seed_for(name));
    let left = config_doc(&mut rng, services);
    let mut right = left.clone();
    let mut erng = Rng::new(seed_for(name) ^ 0xE017);

    let mut paths = Vec::new();
    collect_scalar_paths(&right, &mut Vec::new(), &mut paths);
    let total = paths.len() as u64;

    let desc = match pattern {
        Pattern::Single => {
            let idx = (total * 3 / 5) as usize;
            bump_scalar(resolve_mut(&mut right, &paths[idx]));
            format!("one scalar leaf changed (leaf {idx} of {total})")
        }
        Pattern::Scattered => {
            for k in 0..12u64 {
                let idx = ((2 * k + 1) * total / 24) as usize;
                bump_scalar(resolve_mut(&mut right, &paths[idx]));
            }
            "12 scalar leaves changed, spread evenly".to_string()
        }
        Pattern::Block => {
            let leaf = &paths[(total * 3 / 5) as usize];
            let mut cut = leaf.len();
            while cut > 0 {
                if let Step::Key(_) = leaf[cut - 1] {
                    break;
                }
                cut -= 1;
            }
            let parent = resolve_mut(&mut right, &leaf[..cut.saturating_sub(1)]);
            let mut block = Map::new();
            for i in 0..198u64 {
                block.insert(format!("k{i:03}"), json!(erng.below(1_000_000)));
            }
            insert_key_mid(
                parent
                    .as_object_mut()
                    .expect("block-insert parent is an object"),
                "insertedBlock".to_string(),
                Value::Object(block),
            );
            "~200-line object inserted at ~60% depth".to_string()
        }
        Pattern::Heavy => {
            let mut touched = 0u64;
            for p in &paths {
                if erng.chance(45) {
                    bump_scalar(resolve_mut(&mut right, p));
                    touched += 1;
                }
            }
            format!("~30% of lines changed ({touched} of {total} scalar leaves)")
        }
    };
    (left, right, desc)
}

fn line_count(s: &str) -> u64 {
    s.bytes().filter(|&b| b == b'\n').count() as u64 + 1
}

fn positional_changed(left: &str, right: &str) -> u64 {
    let mut diff = 0u64;
    let mut l = left.split('\n');
    let mut r = right.split('\n');
    loop {
        match (l.next(), r.next()) {
            (Some(a), Some(b)) => {
                if a != b {
                    diff += 1;
                }
            }
            (None, None) => break,
            _ => panic!("positional ground truth requires equal line counts"),
        }
    }
    diff
}

struct Spec {
    name: String,
    shape: &'static str,
    pattern: Pattern,
    size: u64,
}

fn specs() -> Vec<Spec> {
    let mut out = Vec::new();
    let patterns = [
        Pattern::Single,
        Pattern::Scattered,
        Pattern::Block,
        Pattern::Heavy,
    ];
    let pattern_slug = |p: Pattern| match p {
        Pattern::Single => "single",
        Pattern::Scattered => "scattered",
        Pattern::Block => "block",
        Pattern::Heavy => "heavy",
    };
    for (slug, n) in [
        ("500", 500u64),
        ("2k", 2_000),
        ("10k", 10_000),
        ("50k", 50_000),
    ] {
        for p in patterns {
            out.push(Spec {
                name: format!("array-{slug}-{}", pattern_slug(p)),
                shape: "array",
                pattern: p,
                size: n,
            });
        }
    }
    for (slug, services) in [("200", 4u64), ("2k", 51), ("20k", 520)] {
        for p in patterns {
            out.push(Spec {
                name: format!("config-{slug}-{}", pattern_slug(p)),
                shape: "config",
                pattern: p,
                size: services,
            });
        }
    }
    for (slug, n) in [("1mb", 4_500u64), ("20mb", 91_000)] {
        out.push(Spec {
            name: format!("minified-{slug}"),
            shape: "minified",
            pattern: Pattern::Scattered,
            size: n,
        });
    }
    for (slug, n) in [("2k", 130u64), ("20k", 1_300)] {
        out.push(Spec {
            name: format!("reformat-{slug}"),
            shape: "reformat",
            pattern: Pattern::Single,
            size: n,
        });
    }
    out
}

pub fn generate_all() {
    let dir = bench_root().join("fixtures");
    fs::create_dir_all(&dir).expect("create bench/fixtures");

    let mut manifest = Vec::new();
    let mut total_bytes = 0u64;

    for spec in specs() {
        let (left_text, right_text, edit_pattern, expected) = match spec.shape {
            "array" => {
                let (l, r, desc) = build_array_pair(&spec.name, spec.size, spec.pattern);
                let lt = serde_json::to_string_pretty(&l).unwrap();
                let rt = serde_json::to_string_pretty(&r).unwrap();
                let expected = match spec.pattern {
                    Pattern::Block => line_count(&rt) - line_count(&lt),
                    _ => positional_changed(&lt, &rt) * 2,
                };
                (lt, rt, desc, expected)
            }
            "config" => {
                let (l, r, desc) = build_config_pair(&spec.name, spec.size, spec.pattern);
                let lt = serde_json::to_string_pretty(&l).unwrap();
                let rt = serde_json::to_string_pretty(&r).unwrap();
                let expected = match spec.pattern {
                    Pattern::Block => line_count(&rt) - line_count(&lt),
                    _ => positional_changed(&lt, &rt) * 2,
                };
                (lt, rt, desc, expected)
            }
            "minified" => {
                let (l, r, _) = build_array_pair(&spec.name, spec.size, Pattern::Scattered);
                let lt = serde_json::to_string(&l).unwrap();
                let rt = serde_json::to_string(&r).unwrap();
                let expected = positional_changed(&lt, &rt) * 2;
                (
                    lt,
                    rt,
                    "12 scattered edits, whole file is one line".to_string(),
                    expected,
                )
            }
            "reformat" => {
                let mut rng = Rng::new(seed_for(&spec.name));
                let records: Vec<Value> = (0..spec.size).map(|i| record(&mut rng, i)).collect();
                let v = Value::Array(records);
                let lt = serde_json::to_string(&v).unwrap();
                let rt = serde_json::to_string_pretty(&v).unwrap();
                let expected = line_count(&lt) + line_count(&rt);
                (
                    lt,
                    rt,
                    "identical data, minified left vs pretty right".to_string(),
                    expected,
                )
            }
            _ => unreachable!(),
        };

        let entry = ManifestEntry {
            name: spec.name.clone(),
            shape: spec.shape.to_string(),
            left_lines: line_count(&left_text),
            right_lines: line_count(&right_text),
            left_bytes: left_text.len() as u64,
            right_bytes: right_text.len() as u64,
            edit_pattern: edit_pattern.clone(),
            expected_changed_lines: expected,
            lcs_cells: line_count(&left_text) * line_count(&right_text),
        };
        total_bytes += entry.left_bytes + entry.right_bytes;

        fs::write(dir.join(format!("{}.left.json", spec.name)), &left_text).unwrap();
        fs::write(dir.join(format!("{}.right.json", spec.name)), &right_text).unwrap();
        eprintln!(
            "  {}  {} x {} lines, {:.1} MB, expected changed {}",
            entry.name,
            entry.left_lines,
            entry.right_lines,
            (entry.left_bytes + entry.right_bytes) as f64 / 1e6,
            entry.expected_changed_lines
        );
        manifest.push(entry);
    }

    let manifest_text = serde_json::to_string_pretty(&manifest).unwrap();
    fs::write(dir.join("manifest.json"), manifest_text).unwrap();
    eprintln!(
        "wrote {} fixture pairs, {:.1} MB total, manifest at {}",
        manifest.len(),
        total_bytes as f64 / 1e6,
        dir.join("manifest.json").display()
    );
}

pub fn load_manifest() -> Vec<ManifestEntry> {
    let path = bench_root().join("fixtures/manifest.json");
    let text = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "read {}: {e}; run `cargo bench --bench json_linediff -- gen`",
            path.display()
        )
    });
    serde_json::from_str(&text).expect("parse manifest.json")
}
