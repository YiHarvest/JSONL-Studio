use jsonl_studio::core::Session;
use std::{path::PathBuf, time::Instant};

fn main() {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("benchmark <file.jsonl> [runs]"),
    );
    let runs: usize = std::env::args()
        .nth(2)
        .unwrap_or("20".into())
        .parse()
        .unwrap();
    assert!(runs > 0);
    let mut timings = Vec::new();
    for _ in 0..runs {
        let now = Instant::now();
        let session = Session::open(path.clone()).unwrap();
        let page = session.page(1, 100).unwrap();
        timings.push(now.elapsed().as_secs_f64() * 1000.0);
        assert!(!page.records.is_empty());
    }
    timings.sort_by(f64::total_cmp);
    println!(
        "{}",
        serde_json::json!({
            "metric": "core_index_and_first_100_records_ms",
            "runs": runs, "p95": timings[((runs as f64 * 0.95).ceil() as usize - 1).min(runs - 1)],
            "samples": timings, "note": "Cache uncontrolled, core only; excludes WebView startup and rendering"
        })
    );
}
