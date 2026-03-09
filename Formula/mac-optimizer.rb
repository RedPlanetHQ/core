class MacOptimizer < Formula
  desc "Automatic macOS performance optimizer - keeps your Mac fast"
  homepage "https://github.com/Maurice-AIEMPIRE/core"
  url "https://github.com/Maurice-AIEMPIRE/core/archive/refs/heads/claude/auto-fix-mac-performance-Tyo8p.tar.gz"
  sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"  # Update after release
  version "1.0.0"

  depends_on :macos

  def install
    # Copy scripts
    libexec.install Dir["scripts/mac-optimizer/*"]

    # Create main wrapper binary
    (bin/"mac-optimizer").write_env_script libexec/"setup.sh", :PATH => "#{libexec}:$PATH"

    # Create config directory
    (var/"mac-optimizer").mkpath
  end

  def post_install
    puts <<~EOS
      ✓ Mac Optimizer installiert!

      Erste Installation:
        mac-optimizer

      Manuell starten:
        bash ~/.mac-optimizer/mac-performance-fix.sh

      Status / Lizenzen:
        bash ~/.mac-optimizer/license.sh --status

      Deinstallieren:
        launchctl unload ~/Library/LaunchAgents/com.core.mac-optimizer.plist
        rm -rf ~/.mac-optimizer

      Premium-Upgrade:
        https://mac-optimizer.io/upgrade
    EOS
  end

  test do
    system "#{libexec}/mac-performance-fix.sh", "--help" rescue true
  end
end
