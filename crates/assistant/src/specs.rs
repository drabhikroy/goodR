//! What this computer can hold: memory, free disk space, and the chip. Read
//! only when the person agrees in the setup steps, and never sent anywhere.
//! The numbers decide which models are marked as a good fit.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Specs {
    /// Total memory in gigabytes. On Apple silicon the graphics chip shares
    /// it, which is what lets a laptop run a model at all.
    pub memory_gb: f64,
    /// Free space on the disk that will hold the models, in gigabytes.
    pub free_disk_gb: f64,
    /// The chip's name as the system reports it, such as "Apple M2".
    pub chip: String,
    /// True on Apple silicon, where models run on the graphics chip.
    pub apple_silicon: bool,
}

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Reads the specs. `models_dir` is where models will be stored, so the
/// free space reported is for the right disk.
pub fn read(models_dir: &Path) -> Specs {
    let memory_gb = memory_bytes().map(|bytes| bytes as f64 / GB).unwrap_or(0.0);
    let free_disk_gb = free_disk_bytes(models_dir).map(|bytes| bytes as f64 / GB).unwrap_or(0.0);
    let chip = chip_name();
    let apple_silicon = cfg!(target_os = "macos") && cfg!(target_arch = "aarch64");
    Specs { memory_gb: round1(memory_gb), free_disk_gb: round1(free_disk_gb), chip, apple_silicon }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Runs a small system tool and returns what it printed, trimmed.
fn output(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn memory_bytes() -> Option<u64> {
    if cfg!(target_os = "macos") {
        return output("/usr/sbin/sysctl", &["-n", "hw.memsize"])?.parse().ok();
    }
    // Linux reports kilobytes in /proc/meminfo.
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|line| line.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

fn chip_name() -> String {
    if cfg!(target_os = "macos") {
        return output("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"]).unwrap_or_default();
    }
    std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|text| text.lines().find(|line| line.starts_with("model name")).and_then(|line| line.split(':').nth(1)).map(|name| name.trim().to_string()))
        .unwrap_or_default()
}

/// Free space through df, which every Mac and Linux system has. The folder
/// may not exist yet, so the nearest existing parent is measured.
fn free_disk_bytes(dir: &Path) -> Option<u64> {
    let mut target = dir;
    while !target.exists() {
        target = target.parent()?;
    }
    let text = output("df", &["-k", &target.to_string_lossy()])?;
    // The second line holds the numbers. The fourth column is the space
    // available, in kilobytes, on both systems.
    let line = text.lines().nth(1)?;
    let kb: u64 = line.split_whitespace().nth(3)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plausible_numbers_on_this_machine() {
        let dir = tempfile::tempdir().unwrap();
        let specs = read(&dir.path().join("not/made/yet"));
        assert!(specs.memory_gb > 0.5, "memory {}", specs.memory_gb);
        assert!(specs.free_disk_gb > 0.0, "disk {}", specs.free_disk_gb);
    }
}
