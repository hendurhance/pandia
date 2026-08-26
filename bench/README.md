# Line-diff benchmark

Decides which Rust crate replaces the JS line diff in
`src/lib/views/compare/logic/linediff.ts`. The JS implementation builds a dense
O(A\*B) LCS table and, once `A*B` exceeds 4,000,000 cells, silently emits a fake
diff: every left line deleted plus every right line added. This harness exists
to find a Rust candidate that never does that, and to prove it with numbers.

Everything lives in a `harness = false` bench target
(`src-tauri/benches/json_linediff/`). It is compiled only by `cargo bench`;
`cargo build --release` for the app never includes it, and the diff crates are
dev-dependencies only.

## Run it

```sh
cd src-tauri

# 1. Generate fixtures (~205 MB into bench/fixtures/, gitignored)
cargo bench --bench json_linediff -- gen

# 2. Run the full matrix (5 impls x 32 fixtures, ~20-40 min)
cargo bench --bench json_linediff
```

Output:

- `bench/results/rust-diff.json` — one record per (impl, fixture), schema shared
  with the JS benchmark so both can be merged into one table
- a table on stdout, grouped by fixture

Knobs (env vars): `PANDIA_BENCH_TIMEOUT_SECS` (default 90) kills a combination
that runs too long; `PANDIA_BENCH_MAX_RSS_MB` (default 3072) kills one whose
process exceeds that resident set — required because `similar-lcs` allocates an
O(N\*M) table that would swap-kill the machine long before the wall clock fires.

Fixtures are deterministic: a SplitMix64 PRNG seeded from the fixture name, no
wall clock, no system randomness. Re-running `gen` produces byte-identical
files, so results from different days are comparable.

## Headline results (Apple M2, 8 GB, 2026-08-17)

Full numbers in `results/rust-diff.json`. Summary of the 160-combination run:

- **imara-diff histogram wins.** Fastest on nearly every fixture, correct
  changed-line counts everywhere, and flat memory: the 800k-line array-50k
  pairs (640 *billion* LCS cells, 160,000x past the JS cap) diff in 35-110 ms
  with under 60 MB of extra heap. Worst case observed anywhere: 107.7 ms
  (array-50k-heavy).
- **imara-diff myers** is a close second (sometimes faster on single-edit
  giants) and produces exactly-minimal diffs; histogram over-reports by at most
  +64 lines on 410k changed (+0.016%).
- **similar** is consistently 3-10x slower than imara at equal quality;
  `similar-patience` hits 16.5 s on array-50k-heavy.
- **similar-lcs** — the same dense-table idea as the current JS code — needed
  3.3-3.9 GB of heap for 32k-line files and crashed (allocation abort) on the
  four large scattered/heavy array fixtures. This is the JS cap's origin story
  reproduced in Rust.
- **Nobody faked.** 156 ok / 0 degraded / 0 fake / 4 timeout (all similar-lcs
  crashes). Every completing candidate reported truthful counts on every
  fixture, including both shapes designed to hurt: minified (whole file = one
  line, so the only possible answer is 1 del + 1 add) and reformat (100% line
  change is the truth).

## Candidates

| impl id                | crate + algorithm                                    |
| ---------------------- | ---------------------------------------------------- |
| `rust/imara-histogram` | imara-diff, histogram (what gitoxide uses)           |
| `rust/imara-myers`     | imara-diff, Myers with git-style cost heuristics     |
| `rust/similar-myers`   | similar, `Algorithm::Myers` (heuristic, bounded work) |
| `rust/similar-patience`| similar, `Algorithm::Patience`                       |
| `rust/similar-lcs`     | similar, `Algorithm::Lcs` (dense table — the same idea as the current JS) |

Note on similar 3.x: `Algorithm::Myers` is the *heuristic* Myers — it trades a
minimal edit script for bounded work on hard inputs (`Algorithm::RawMyers` is
the exact one). That is favorable to similar here: it degrades instead of
hanging, and the quality column shows when it degrades.

## What each shape models

- **array** — log/API-dump style records (id, timestamp, level, message, nested
  meta, tags), pretty-printed. The most important shape: it is what people
  actually compare in a JSON IDE. Sizes 500 / 2k / 10k / 50k elements
  (~8k to ~800k lines).
- **config** — deeply nested package.json / tsconfig / k8s-manifest style
  documents. Small objects, heavy nesting, few arrays. ~200 / ~2k / ~20k lines.
  The 200- and 2k-line sizes sit *under* the JS 4M-cell cap, so they are where
  the JS diff still works and Rust must merely be faster.
- **minified** — the array data serialized with no whitespace: the whole file is
  one line (~1 MB and ~20 MB). Pathological for any line-based diff by
  construction; the result we want on record is *how* each candidate fails
  (it can only say "1 line deleted, 1 line added" for a 20 MB document).
- **reformat** — semantically identical data, minified on the left,
  pretty-printed on the right. Zero semantic change, 100% line change. Every
  line diff must report ~everything changed here; the point is to document that
  blind spot with numbers (the real fix is diffing parsed values, not lines).

Edit patterns for array and config: `single-value` (one scalar deep in the
document), `scattered` (12 small edits spread evenly), `block-insert` (~200
contiguous new elements/lines at ~60% depth), `heavy` (~30% of lines changed
throughout — the pattern that puts the JS diff far past its cap).

`expectedChangedLines` in `manifest.json` is exact ground truth by
construction: in-place edits never add or remove lines, so it is twice the
count of positionally differing lines (each changed line = one del + one add);
for block-insert it is the inserted line count; for reformat it is
leftLines + rightLines (no line survives reformatting).

## Reading the quality column

Computed against `expectedChangedLines` (`E`), reported changed lines (`C`),
total lines (`T`):

- **ok** — `C` within `E ± max(10%, 10 lines)`. The diff found what actually
  changed.
- **degraded** — outside that band but not fake. Typically a heuristic
  (histogram fallback, bounded Myers) reporting more changed lines than
  minimal. Usable, but noisier for the user.
- **fake** — `C >= 90% of T` while `E < 50% of T`: the diff claims essentially
  everything changed when little did. This is the JS-fallback failure mode this
  benchmark exists to expose. Any candidate showing it is disqualified at that
  size.
- **timeout** — did not produce a diff: killed by the wall-clock limit, killed
  by the RSS cap, or crashed (e.g. aborted on a failed multi-GB allocation).
  Its `medianMs`/`peakHeapBytes`/`hunks`/`changedLines` are `null` in the JSON.

`peakHeapBytes` is measured by a tracking `#[global_allocator]` (current/peak
byte counters around a probe run) and reports the diff's own allocation above
the baseline holding the two input strings. It is the number that matters most:
the JS implementation's table memory is what forced the 4M-cell cap.

## Driver choice: criterion (driven programmatically)

Criterion, not divan, for three reasons:

1. **Machine-readable output.** Criterion persists `estimates.json` per
   benchmark; the harness harvests the median from there to build
   `rust-diff.json`. Divan prints a table and offers no way to get numbers back
   out programmatically.
2. **Drivable without the macro harness.** Each (impl, fixture) pair runs in an
   isolated child process so the parent can kill hangs and memory blowups.
   Criterion's `Criterion::default().bench_function(...)` API works fine inside
   that child; divan's attribute-registration model does not fit
   subprocess-per-combination.
3. **Robust statistics** (outlier detection, warm-up) for the fast combos where
   noise actually matters.

Criterion cannot time-box a single iteration, so the child first does one probe
run: if it is fast (≤1.5 s) criterion measures properly; if slow (≤15 s) the
child reports the median of 3 manual runs; slower still, the probe alone. The
parent's kill covers everything beyond that. Skipped-by-kill combinations are
recorded as `timeout` rather than hanging the run.
