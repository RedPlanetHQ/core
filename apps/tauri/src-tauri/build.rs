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

    // Voice features are macOS-only. The bundle.resources entry that
    // references binaries/core-voice lives in tauri.macos.conf.json,
    // which Tauri auto-merges only on macOS builds — Linux/Windows
    // bundles never see it, so no placeholder file is needed here.

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn build_swift_voice() -> Result<(), String> {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?,
    );

    // CI escape hatch — when the workflow has already built a universal
    // Swift helper into `binaries/core-voice` (e.g. via lipo on
    // arm64+x86_64 builds), we don't want a per-arch cargo pass to
    // overwrite it with a single-arch binary. Setting this env var
    // skips the swift compile + copy entirely.
    if std::env::var("CORE_VOICE_PREBUILT").is_ok() {
        let prebuilt = manifest_dir.join("binaries/core-voice");
        if !prebuilt.exists() {
            return Err(format!(
                "CORE_VOICE_PREBUILT set but {} not found",
                prebuilt.display()
            ));
        }
        println!(
            "cargo:warning=swift-voice using pre-built binary at {}",
            prebuilt.display()
        );
        return Ok(());
    }

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

    // Two destinations:
    //
    //   • target/{profile}/core-voice — picked up by `tauri dev`
    //     (helper_path() looks next to current_exe).
    //
    //   • src-tauri/binaries/core-voice — referenced by tauri.conf.json's
    //     bundle.resources so the binary is copied into
    //     Core.app/Contents/Resources/core-voice during `tauri build`.
    let target_dir = manifest_dir.join("target").join(&profile);
    let _ = std::fs::create_dir_all(&target_dir);
    let target_dest = target_dir.join("core-voice");
    std::fs::copy(&built, &target_dest)
        .map_err(|e| format!("copy to target failed: {e}"))?;

    let bundle_dir = manifest_dir.join("binaries");
    let _ = std::fs::create_dir_all(&bundle_dir);
    let bundle_dest = bundle_dir.join("core-voice");
    std::fs::copy(&built, &bundle_dest)
        .map_err(|e| format!("copy to bundle dir failed: {e}"))?;

    Ok(())
}
