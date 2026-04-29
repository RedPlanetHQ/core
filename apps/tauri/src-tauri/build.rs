use std::path::PathBuf;
use std::process::Command;

fn main() {
    // On macOS, compile the Swift voice helper and stage its binary so the
    // Rust speech bridge can spawn it at runtime. Failures here are
    // non-fatal during dev — voice mode just won't work until the binary
    // exists on disk. In release builds we hard-fail to surface broken
    // bundles before they ship.
    #[cfg(target_os = "macos")]
    {
        if let Err(err) = build_swift_voice() {
            let is_release = std::env::var("PROFILE").ok().as_deref() == Some("release");
            if is_release {
                panic!("swift-voice build failed: {err}");
            } else {
                println!("cargo:warning=swift-voice build failed (non-fatal in dev): {err}");
            }
        }
    }

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn build_swift_voice() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?,
    );
    let pkg_dir = manifest_dir.join("swift-voice");
    if !pkg_dir.join("Package.swift").exists() {
        return Err(format!(
            "swift-voice/Package.swift missing at {}",
            pkg_dir.display()
        ));
    }

    println!(
        "cargo:rerun-if-changed={}",
        pkg_dir.join("Package.swift").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        pkg_dir.join("Sources/CoreVoice/main.swift").display()
    );

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let swift_config = if profile == "release" { "release" } else { "debug" };

    let status = Command::new("swift")
        .args(["build", "-c", swift_config])
        .current_dir(&pkg_dir)
        .status()
        .map_err(|e| format!("failed to spawn swift: {e}"))?;
    if !status.success() {
        return Err(format!("swift build exited with status {status}"));
    }

    let built = pkg_dir
        .join(".build")
        .join(swift_config)
        .join("core-voice");
    if !built.exists() {
        return Err(format!(
            "expected binary not found at {}",
            built.display()
        ));
    }

    // Copy next to the cargo target so the Rust side can find it via
    // OUT_DIR-relative lookup at runtime (dev) or through Tauri's
    // resource bundling (release).
    let target_dir = manifest_dir.join("target").join(&profile);
    let _ = std::fs::create_dir_all(&target_dir);
    let dest = target_dir.join("core-voice");
    std::fs::copy(&built, &dest).map_err(|e| format!("copy failed: {e}"))?;

    Ok(())
}
