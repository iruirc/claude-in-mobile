use std::fs;
use std::process::{Command, Output};

use serde_json::Value;
use tempfile::TempDir;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_mcp-devices")
}

fn run(args: &[&str]) -> Output {
    Command::new(bin())
        .args(args)
        .output()
        .expect("spawn mcp-devices")
}

#[test]
fn heap_diff_reports_signed_artifact_growth() {
    let root = TempDir::new().expect("performance tempfile");
    let before = root.path().join("before.hprof");
    let after = root.path().join("after.hprof");
    fs::write(&before, vec![0u8; 10]).expect("write before fixture");
    fs::write(&after, vec![0u8; 15]).expect("write after fixture");

    let output = run(&[
        "perf-heap-diff",
        before.to_str().expect("before path"),
        after.to_str().expect("after path"),
    ]);

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).expect("heap diff JSON");
    assert_eq!(result["metric"], "artifactSize");
    assert_eq!(result["beforeBytes"], 10);
    assert_eq!(result["afterBytes"], 15);
    assert_eq!(result["deltaBytes"], 5);
    assert_eq!(result["deltaPercent"], 50.0);
}

#[test]
fn trace_duration_is_bounded_before_device_access() {
    let output = run(&[
        "perf-trace",
        "--platform",
        "android",
        "--package",
        "com.example.app",
        "--duration-ms",
        "999",
        "--output",
        "/tmp/unused.perfetto-trace",
    ]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("1000..=15000"));
}

#[test]
fn heap_capture_refuses_to_overwrite_artifacts() {
    let root = TempDir::new().expect("performance tempfile");
    let artifact = root.path().join("existing.hprof");
    fs::write(&artifact, b"keep").expect("write existing artifact");

    let output = run(&[
        "perf-heap-capture",
        "--platform",
        "android",
        "--package",
        "com.example.app",
        "--output",
        artifact.to_str().expect("artifact path"),
    ]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Refusing to overwrite"));
    assert_eq!(
        fs::read(&artifact).expect("read existing artifact"),
        b"keep"
    );
}
