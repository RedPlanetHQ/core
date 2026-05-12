/**
 * Expo config plugin: copies plugins/StartVoiceIntent.swift into the
 * generated iOS project on `expo prebuild` and registers it as a source
 * file on the main app target so it gets compiled.
 *
 * Without this, the Swift file would be wiped each time prebuild
 * regenerates ios/ — the whole point of having a config plugin.
 */

const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SWIFT_FILENAME = "StartVoiceIntent.swift";

function withCopySwiftFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const { projectName, projectRoot, platformProjectRoot } = cfg.modRequest;
      const src = path.join(projectRoot, "plugins", SWIFT_FILENAME);
      const destDir = path.join(platformProjectRoot, projectName);
      const dest = path.join(destDir, SWIFT_FILENAME);

      if (!fs.existsSync(src)) {
        throw new Error(`with-voice-intent: source file missing at ${src}`);
      }
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      return cfg;
    },
  ]);
}

function withSwiftFileRegistered(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName;
    const filePath = `${projectName}/${SWIFT_FILENAME}`;

    // Bail if already registered (e.g. re-running prebuild without --clean).
    const existing = project.pbxFileReferenceSection();
    for (const key of Object.keys(existing)) {
      const ref = existing[key];
      if (typeof ref === "object" && ref.path && ref.path.includes(SWIFT_FILENAME)) {
        return cfg;
      }
    }

    const target = project.getFirstTarget();
    const group = project.findPBXGroupKey({ name: projectName });
    if (!target || !group) return cfg;

    project.addSourceFile(
      filePath,
      { target: target.uuid, lastKnownFileType: "sourcecode.swift" },
      group,
    );
    return cfg;
  });
}

module.exports = function withVoiceIntent(config) {
  config = withCopySwiftFile(config);
  config = withSwiftFileRegistered(config);
  return config;
};
