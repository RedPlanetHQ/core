import Foundation
import AVFoundation
import CoreAudio
import Speech

// MARK: - Newline-delimited JSON protocol over stdin/stdout
//
// Commands (stdin):
//   {"cmd": "request_permissions"}
//   {"cmd": "start_listening"}
//   {"cmd": "stop_listening"}
//   {"cmd": "speak", "text": "..."}
//   {"cmd": "cancel_speech"}
//
// Events (stdout):
//   {"event": "ready"}
//   {"event": "permissions", "mic": "granted|denied|undetermined", "speech": "granted|denied|restricted|notDetermined"}
//   {"event": "partial", "text": "...", "isFinal": false}
//   {"event": "final", "text": "..."}
//   {"event": "tts-started"}
//   {"event": "tts-ended"}
//   {"event": "silence-timeout"}
//   {"event": "error", "message": "..."}
//
// The binary stays alive across many turns. lib.rs spawns it once on app
// startup and pipes commands as needed.

// ------------------------------------------------------------------
// stdout writer (line-buffered JSON)
// ------------------------------------------------------------------

let stdoutLock = NSLock()

func emit(_ event: [String: Any]) {
    stdoutLock.lock()
    defer { stdoutLock.unlock() }
    guard
        let data = try? JSONSerialization.data(withJSONObject: event, options: []),
        var line = String(data: data, encoding: .utf8)
    else { return }
    line.append("\n")
    FileHandle.standardOutput.write(line.data(using: .utf8) ?? Data())
}

func emitError(_ message: String) {
    emit(["event": "error", "message": message])
}

func emitLog(_ msg: String) {
    // Diagnostic events surfaced to the main Tauri log.
    emit(["event": "log", "message": msg])
}

func stderrLog(_ msg: String) {
    // Natural Swift logging — ends up in [core-voice/stderr] info lines.
    FileHandle.standardError.write(("[core-voice] " + msg + "\n").data(using: .utf8) ?? Data())
}

// ------------------------------------------------------------------
// Speech recognition + synthesis controller
// ------------------------------------------------------------------

final class VoiceController: NSObject, AVSpeechSynthesizerDelegate {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    /// `var` rather than `let` because if a pinned device can't actually
    /// be driven by AVAudioEngine (some Bluetooth headsets fail to start
    /// with `kAudioUnitErr_FormatNotSupported` / -10868) the cleanest way
    /// to reset the AUHAL's device override is to drop the engine and
    /// build a fresh one. See `installTapAndStartEngine` for the fallback.
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let synthesizer = AVSpeechSynthesizer()
    private var lastEmittedFinalText: String = ""
    private var latestPartialText: String = ""
    private var hasEndAudioed: Bool = false
    private var hasDeliveredFinal: Bool = false
    private var fallbackFinalWorkItem: DispatchWorkItem?
    /// Text accumulated across recognizer restarts within a single
    /// listening session. Apple's SFSpeechRecognizer ends a task on
    /// silence ("no speech" error) or by deciding the user is done
    /// (`isFinal=true`); we preserve what was already recognized and
    /// keep the mic alive until the caller explicitly stops.
    private var preservedPrefix: String = ""
    /// The most recent raw transcript from the *current* recognition
    /// task (without `preservedPrefix`). Used to detect when on-device
    /// SFSpeechRecognizer rolls over to a new utterance mid-task: with
    /// `addsPunctuation = true` the recognizer sometimes commits a
    /// sentence at a pause and resets `bestTranscription.formattedString`
    /// to just the new utterance — we detect that and promote the old
    /// raw into `preservedPrefix` so we don't drop the earlier text.
    private var lastRawInTask: String = ""

    // Target format for SFSpeechRecognizer — mono 16kHz Float32. Apple's
    // recognizer tolerates the device's native format on most Macs, but
    // when the default input is a multi-channel device (aggregate /
    // virtual audio / pro audio interface) the recognizer silently
    // drops the buffer. Converting once gives us a stable contract.
    private lazy var recognitionFormat: AVAudioFormat = {
        AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        )!
    }()
    private var converter: AVAudioConverter?

    /// User-chosen voice identifier (e.g. "com.apple.voice.premium.en-US.Zoe").
    /// Set by the Rust side either at helper startup (from config.json) or
    /// when the user picks a voice in Settings. nil = pick automatically.
    private var preferredVoiceIdentifier: String?

    /// Observer for `AVAudioEngineConfigurationChange` — fires when the
    /// audio route changes (headphones plugged in/out, AirPods connecting,
    /// default input device switching). Apple auto-stops the engine when
    /// this fires; we must reinstall the tap with the *new* input format
    /// and restart, otherwise buffers either stop flowing or arrive in a
    /// format the previously-built `AVAudioConverter` can't parse and the
    /// recognizer goes silent.
    private var configChangeObserver: NSObjectProtocol?

    /// Audio device ID we explicitly pinned the engine's input node to at
    /// `startListening` time — i.e. whatever the system default input was
    /// the moment the user pressed the hotkey. We hold this device for
    /// the rest of the listening session and ignore macOS's attempts to
    /// re-route us mid-session.
    ///
    /// Why: AirPods Max and other Bluetooth headsets cause macOS to
    /// silently swap the default input device when other audio activity
    /// changes (e.g., Spotify pausing makes macOS try to put AirPods into
    /// HFP/SCO mic mode, which is broken on recent macOS). Without
    /// pinning, our engine follows that swap and ends up bound to a
    /// half-working HFP device. Pinning to "whatever was default at
    /// hotkey-press time" keeps dictation on the device the user was
    /// effectively choosing when they triggered the widget.
    ///
    /// `kAudioObjectUnknown` = not pinned (engine follows system default).
    private var pinnedInputDeviceID: AudioDeviceID = AudioDeviceID(kAudioObjectUnknown)

    /// Debounces the route-change rebuild. AirPods reconnect (and other
    /// BT profile renegotiations) post 3-4 `AVAudioEngineConfigurationChange`
    /// notifications back-to-back. Acting on each one risks tearing down
    /// a freshly-started engine from a previous rebuild that's still
    /// settling. We coalesce: every notification cancels the previous
    /// pending rebuild and re-schedules ~150ms out, so the rebuild fires
    /// once after the flurry quiets down.
    private var pendingRouteRebuild: DispatchWorkItem?

    // ── VAD (voice activity detection) ─────────────────────────────────
    // Coarse RMS-based silence detection on the converted recognizer
    // buffer (mono 16 kHz float32). Drives the auto-commit signal in
    // active mode — the widget sees `silence-timeout` and stops the
    // recognizer. Apple's own no-speech error fires only after ~2-3 s
    // of silence, which is too sluggish for back-and-forth dialogue.
    private static let vadRmsThreshold: Float = 0.015
    private static let vadSilenceDuration: TimeInterval = 0.5
    /// Has any above-threshold buffer arrived during this session? We
    /// gate the silence timer on this so a slow speaker doesn't trip it
    /// before they've said the first word.
    private var vadHeardSpeech: Bool = false
    /// When silence began (post-speech), or nil while we're still
    /// hearing audio above the threshold.
    private var vadSilenceStartedAt: Date?
    /// Latch so the event fires at most once per listening session.
    /// Cleared on each user-initiated startListening (not on Apple's
    /// internal restarts — the prior fire still applies to the same
    /// user-perceived session).
    private var vadFiredSilenceTimeout: Bool = false

    // ── Restart backoff ────────────────────────────────────────────────
    // Apple's recognizer occasionally fires no-speech / isFinal-mid-session
    // *immediately* on a fresh task (recognizer disabled, dictation off,
    // entitlement issue, broken on-device model). Without throttling the
    // synchronous cancel+restart loop pegs a core and floods the log at
    // hundreds of restarts per second. We rate-limit restarts and bail
    // out after a cap of consecutive empty restarts.
    private var consecutiveEmptyRestarts: Int = 0
    private var lastRestartAt: Date?
    private var pendingRestart: DispatchWorkItem?
    private static let restartMinIntervalSec: TimeInterval = 0.35
    private static let restartMaxConsecutive: Int = 6

    override init() {
        super.init()
        synthesizer.delegate = self
        installConfigChangeObserver()
    }

    private func installConfigChangeObserver() {
        if let obs = configChangeObserver {
            NotificationCenter.default.removeObserver(obs)
        }
        configChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: audioEngine,
            queue: .main
        ) { [weak self] _ in
            self?.scheduleRouteRebuild()
        }
    }

    deinit {
        if let obs = configChangeObserver {
            NotificationCenter.default.removeObserver(obs)
        }
    }

    // -------- permissions --------

    func requestPermissions() {
        SFSpeechRecognizer.requestAuthorization { speechAuth in
            // macOS doesn't expose AVAudioSession; mic permission is requested
            // implicitly when AVAudioEngine starts. We surface the recorded
            // bool from AVCaptureDevice as a proxy.
            let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
            DispatchQueue.main.async {
                emit([
                    "event": "permissions",
                    "mic": Self.micString(micStatus),
                    "speech": Self.speechString(speechAuth),
                ])
            }
        }
    }

    private static func micString(_ s: AVAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "undetermined"
        @unknown default: return "undetermined"
        }
    }

    private static func speechString(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    // -------- listening --------

    func startListening(internalRestart: Bool = false) {
        stderrLog("startListening called (internalRestart=\(internalRestart))")
        guard let recognizer else {
            emitError("speech recognizer init failed (locale?)")
            return
        }
        guard recognizer.isAvailable else {
            emitError("speech recognizer unavailable — enable Siri/Dictation in System Settings")
            return
        }
        stderrLog("recognizer available, supportsOnDevice=\(recognizer.supportsOnDeviceRecognition)")

        if audioEngine.isRunning {
            stderrLog("audio engine already running, ignoring start")
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        if #available(macOS 13.0, *) {
            req.addsPunctuation = true
        }
        if #available(macOS 10.15, *) {
            if recognizer.supportsOnDeviceRecognition {
                req.requiresOnDeviceRecognition = true
                stderrLog("requiresOnDeviceRecognition = true")
            } else {
                stderrLog("on-device recognition NOT supported — using cloud")
            }
        }
        request = req

        // Pin the engine's input to whatever the system thinks is the
        // default input device *right now* — i.e. the device the user
        // implicitly chose when they pressed the hotkey. We hold this
        // device for the whole session so a mid-session route change
        // (e.g. AirPods Max swapping into HFP when Spotify pauses)
        // can't yank the mic out from under the recognizer. Only on a
        // fresh user-triggered start (not internal recognizer restarts)
        // do we re-snapshot the default.
        if !internalRestart {
            if let dev = currentDefaultInputDevice() {
                pinnedInputDeviceID = dev
                stderrLog("pinning input to system default device id=\(dev) for this session")
            } else {
                pinnedInputDeviceID = AudioDeviceID(kAudioObjectUnknown)
                stderrLog("no default input device — falling back to engine's automatic selection")
            }
        }
        applyPinnedInputDevice()

        // NOTE: deliberately not calling setVoiceProcessingEnabled —
        // it inserts AEC reference channels into the buffer that the
        // recognizer can't parse. We instead convert whatever the
        // device gives us into mono 16kHz Float32 in the tap callback.
        if !installTapAndStartEngine() {
            return
        }

        lastEmittedFinalText = ""
        hasEndAudioed = false
        hasDeliveredFinal = false
        if !internalRestart {
            preservedPrefix = ""
            // Fresh user-initiated session — VAD starts clean. Internal
            // restarts inherit the prior gating so we don't fire twice
            // for the same logical pause.
            vadHeardSpeech = false
            vadSilenceStartedAt = nil
            vadFiredSilenceTimeout = false
            // Fresh session — the recognizer earned a clean slate of
            // restart attempts.
            consecutiveEmptyRestarts = 0
            lastRestartAt = nil
            pendingRestart?.cancel()
            pendingRestart = nil
        }
        // Seed latestPartialText with whatever we've already preserved so
        // a stop()/error path that delivers `latestPartialText` before the
        // new task emits its first partial doesn't drop the prefix.
        latestPartialText = preservedPrefix
        // Fresh task → no within-task raw yet.
        lastRawInTask = ""
        stderrLog("creating recognition task (preservedPrefix=\(preservedPrefix.count) chars)")
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let raw = result.bestTranscription.formattedString
                // On-device SFSpeechRecognizer with `addsPunctuation` will
                // sometimes commit a sentence at a pause and reset
                // `formattedString` to *just* the new utterance — dropping
                // earlier sentences from the visible transcript. We detect
                // that here (new raw is shorter than what we last saw and
                // shares almost no prefix with it) and promote the dropped
                // text into `preservedPrefix` so the caller still sees
                // everything.
                if self.detectRollover(previous: self.lastRawInTask, new: raw) {
                    let promoted = self.combineWithPrefix(self.lastRawInTask)
                    stderrLog("recognizer rolled over within task — promoting \(promoted.count) chars to preservedPrefix")
                    self.preservedPrefix = promoted
                }
                self.lastRawInTask = raw
                let combined = self.combineWithPrefix(raw)
                // Apple sometimes delivers `isFinal=true` *after* endAudio
                // with an empty `bestTranscription.formattedString` even
                // when there's a perfectly good in-flight partial. Don't
                // let that empty payload wipe what we already have.
                if !combined.isEmpty {
                    self.latestPartialText = combined
                }
                if result.isFinal {
                    // Commit the richer of the two: a non-empty
                    // `combined` from this result, otherwise whatever
                    // partial we had right before endAudio.
                    let committed = combined.isEmpty ? self.latestPartialText : combined
                    stderrLog("recognizer result isFinal=true (combined=\(combined.count) chars, latestPartial=\(self.latestPartialText.count) chars, hasEndAudioed=\(self.hasEndAudioed))")
                    if self.hasEndAudioed {
                        // User released keys → commit.
                        self.deliverFinalIfNeeded(committed)
                    } else {
                        // Recognizer decided we're done mid-hold (e.g.
                        // long pause). User is still holding keys, so
                        // preserve what we have and start a fresh task
                        // so they can keep talking.
                        DispatchQueue.main.async {
                            // The user may have released keys between the
                            // recognizer firing isFinal and this dispatch
                            // running. Re-check before reopening the mic —
                            // otherwise we restart into silence and the
                            // final is never delivered.
                            let payload = committed
                            if self.hasEndAudioed {
                                stderrLog("recognizer isFinal mid-session, but user released — committing \(payload.count) chars")
                                self.deliverFinalIfNeeded(payload)
                                return
                            }
                            stderrLog("recognizer isFinal mid-session — preserving \(payload.count) chars and restarting")
                            self.scheduleRestart(preserving: payload, reason: "isFinal mid-session")
                        }
                    }
                } else {
                    emit(["event": "partial", "text": combined, "isFinal": false])
                }
            }
            if let error = error as NSError? {
                // After endAudio() the recognizer often fires an error
                // (e.g., kAFAssistantErrorDomain code 1110, "no speech")
                // INSTEAD of a result.isFinal=true. Treat it as the final
                // transcript when we have a non-empty partial.
                let msg = error.localizedDescription.lowercased()
                let isNoSpeech = msg.contains("no speech")
                    || error.code == 203
                    || error.code == 301
                    || error.code == 1101
                    || error.code == 1110

                stderrLog("recognizer error code=\(error.code) isNoSpeech=\(isNoSpeech) hasEndAudioed=\(self.hasEndAudioed) hasDeliveredFinal=\(self.hasDeliveredFinal) msg=\"\(error.localizedDescription)\"")

                if self.hasEndAudioed {
                    self.deliverFinalIfNeeded(self.latestPartialText)
                } else if isNoSpeech && !self.hasDeliveredFinal {
                    // Apple's recognizer ends the task on extended
                    // silence even mid-hold. Preserve everything we've
                    // recognized so far and restart so the user can
                    // pause and keep talking without losing text.
                    //
                    // `hasDeliveredFinal` is also flipped true by
                    // `cancelListening`, which is how we tell apart
                    // "recognizer hit a benign silence error mid
                    // session" (restart) from "user dismissed the panel
                    // and we explicitly tore down the engine" (don't
                    // restart — that's what was leaving the orange mic
                    // indicator stuck after the panel hid).
                    DispatchQueue.main.async {
                        let saved = self.latestPartialText
                        // Same race as the isFinal branch: the user may
                        // have released keys before this dispatch ran. If
                        // so, commit instead of reopening the mic.
                        if self.hasEndAudioed {
                            stderrLog("recognizer no-speech, user released — committing \(saved.count) chars")
                            self.deliverFinalIfNeeded(saved)
                            return
                        }
                        stderrLog("recognizer no-speech mid-session — preserving \(saved.count) chars and restarting")
                        self.scheduleRestart(preserving: saved, reason: "no-speech mid-session")
                    }
                } else if !isNoSpeech {
                    emitError("recognition: \(error.localizedDescription)")
                }
            }
        }
    }

    /// True when SFSpeechRecognizer appears to have committed the
    /// previous utterance and started a new one within the same task —
    /// i.e. `new` is materially different from `previous` rather than a
    /// continuation or a word-level revision.
    ///
    /// Heuristic:
    /// - require the previous raw to be substantial (≥8 chars), because
    ///   short partials are usually just the recognizer revising its
    ///   guess (e.g. "Hi" → "Hey")
    /// - new must be shorter than previous (a rollover restarts from a
    ///   short fragment; a revision tends to keep or grow length)
    /// - longest common prefix must be tiny (revisions almost always
    ///   share most of the leading text; rollovers don't)
    private func detectRollover(previous: String, new: String) -> Bool {
        if previous.count < 8 { return false }
        if new.isEmpty { return false }
        if new.count >= previous.count { return false }
        if new.hasPrefix(previous) { return false }   // pure continuation
        if previous.hasPrefix(new) { return false }   // backward revision
        let prevChars = Array(previous)
        let newChars = Array(new)
        var lcp = 0
        while lcp < prevChars.count && lcp < newChars.count && prevChars[lcp] == newChars[lcp] {
            lcp += 1
        }
        return lcp < 3
    }

    /// Join a new task's raw transcript onto whatever we preserved from
    /// earlier tasks in the same listening session.
    private func combineWithPrefix(_ raw: String) -> String {
        if preservedPrefix.isEmpty { return raw }
        if raw.isEmpty { return preservedPrefix }
        return preservedPrefix + " " + raw
    }

    /// Emit the final transcript at most once per session.
    private func deliverFinalIfNeeded(_ text: String) {
        if hasDeliveredFinal {
            stderrLog("deliverFinalIfNeeded skipped — final already delivered")
            return
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            stderrLog("deliverFinalIfNeeded skipped — empty text after trim (latestPartial=\(text.count) chars)")
            hasDeliveredFinal = true
            return
        }
        hasDeliveredFinal = true
        lastEmittedFinalText = trimmed
        fallbackFinalWorkItem?.cancel()
        fallbackFinalWorkItem = nil
        emit(["event": "final", "text": trimmed])
    }

    /// Finalize the current dictation without canceling — `endAudio()`
    /// asks the recognizer to flush its buffer. With on-device
    /// SFSpeechRecognizer this often produces an *error* (1110, etc.)
    /// rather than a `result.isFinal=true`; the recognitionTask
    /// callback handles both paths via deliverFinalIfNeeded. We also
    /// arm a fallback timer that emits the latest partial as final if
    /// the recognizer never calls back.
    func stopListening() {
        stderrLog("stopListening (endAudio)")
        hasEndAudioed = true
        request?.endAudio()
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        armFinalFallback()
    }

    /// Re-enter the recognizer after a mid-session no-speech / isFinal,
    /// preserving whatever text has accumulated so far. Rate-limits the
    /// restart and bails out after a cap of consecutive empty restarts —
    /// without this guard a recognizer that fires no-speech instantly on
    /// every fresh task (entitlement/model/permission issue) drives an
    /// unbounded synchronous cancel/start loop. See `restartMaxConsecutive`
    /// / `restartMinIntervalSec` for the bounds.
    private func scheduleRestart(preserving: String, reason: String) {
        // Cancel any restart that didn't fire yet — only the latest
        // request matters.
        pendingRestart?.cancel()
        pendingRestart = nil

        // An "empty" restart preserved zero characters of speech. That's
        // the signature of a recognizer that's not actually transcribing
        // anything — count those toward the bail-out cap.
        if preserving.isEmpty {
            consecutiveEmptyRestarts += 1
        } else {
            consecutiveEmptyRestarts = 0
        }

        if consecutiveEmptyRestarts > Self.restartMaxConsecutive {
            stderrLog("restart bailout: \(consecutiveEmptyRestarts) consecutive empty restarts (\(reason)) — giving up")
            cancelListening()
            emitError("recognition restarted with no speech \(consecutiveEmptyRestarts) times — check Dictation/Siri permissions")
            return
        }

        // Tear the current task down right now so the recognizer/audio
        // engine are quiesced before the next start. The actual restart
        // is deferred so we don't spin within the same tick.
        cancelListening()
        preservedPrefix = preserving

        let now = Date()
        let elapsed = lastRestartAt.map { now.timeIntervalSince($0) } ?? .greatestFiniteMagnitude
        let delay = max(0, Self.restartMinIntervalSec - elapsed)
        lastRestartAt = now

        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.pendingRestart = nil
            // Re-check that the user hasn't released keys in the gap.
            if self.hasEndAudioed {
                stderrLog("restart skipped — user released keys during backoff (\(reason))")
                return
            }
            self.startListening(internalRestart: true)
        }
        pendingRestart = work
        if delay <= 0 {
            DispatchQueue.main.async(execute: work)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }

    /// Hard-cancel — used when the user dismisses the widget without
    /// wanting a final transcript.
    func cancelListening() {
        stderrLog("cancelListening")
        fallbackFinalWorkItem?.cancel()
        fallbackFinalWorkItem = nil
        pendingRouteRebuild?.cancel()
        pendingRouteRebuild = nil
        // If we're tearing down, any deferred restart belongs to the
        // previous session and must not reopen the mic.
        pendingRestart?.cancel()
        pendingRestart = nil
        hasDeliveredFinal = true // suppress any late callback
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        // Note: we deliberately do NOT clear pinnedInputDeviceID here.
        // The recognizer's no-speech / mid-task-isFinal paths call
        // cancelListening() and immediately re-enter via
        // startListening(internalRestart: true) — clearing the pin would
        // make the internal restart fall back to the (now-flapping)
        // system default and undo the entire fix. The pin gets refreshed
        // by the `if !internalRestart` block in startListening on the
        // next user-triggered session, which is the only place a
        // "fresh" pin matters.
    }

    private func armFinalFallback() {
        fallbackFinalWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            // If the recognizer hasn't called back within the window,
            // commit the latest partial as the final transcript.
            stderrLog("fallbackFinal firing — latestPartial=\(self.latestPartialText.count) chars, hasDeliveredFinal=\(self.hasDeliveredFinal)")
            self.deliverFinalIfNeeded(self.latestPartialText)
        }
        fallbackFinalWorkItem = work
        stderrLog("fallbackFinal armed (1.8s) — latestPartial=\(self.latestPartialText.count) chars")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: work)
    }

    /// Read the system default *input* device ID via Core Audio.
    /// Returns nil if there is no input device or the query fails.
    private func currentDefaultInputDevice() -> AudioDeviceID? {
        var deviceID = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &deviceID
        )
        if status != noErr || deviceID == AudioDeviceID(kAudioObjectUnknown) {
            stderrLog("AudioObjectGetPropertyData(DefaultInputDevice) failed status=\(status)")
            return nil
        }
        return deviceID
    }

    /// Returns true if a previously-snapshotted device ID still refers to
    /// a device that exists on the system (i.e. wasn't unplugged).
    private func deviceStillExists(_ id: AudioDeviceID) -> Bool {
        if id == AudioDeviceID(kAudioObjectUnknown) { return false }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        let szStatus = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size
        )
        if szStatus != noErr { return false }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        if count == 0 { return false }
        var devices = [AudioDeviceID](repeating: AudioDeviceID(kAudioObjectUnknown), count: count)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &devices
        )
        if status != noErr { return false }
        return devices.contains(id)
    }

    /// Force the input node's underlying AUHAL audio unit to capture from
    /// `pinnedInputDeviceID`, overriding whatever macOS picked as the
    /// default. No-op when the pin is unknown (we let the engine pick).
    ///
    /// Important: `kAudioOutputUnitProperty_CurrentDevice` can only be
    /// set when the AU is uninitialized. After the first
    /// `audioEngine.start()`, the AU stays initialized through
    /// subsequent stops — so on the route-change path we MUST call
    /// `AudioUnitUninitialize` first or the property set silently fails
    /// with `kAudioUnitErr_Initialized` (-10851) and the pin is lost.
    ///
    /// We then explicitly re-initialize the AU before returning. Leaving
    /// it uninitialized makes `inputNode.outputFormat(forBus: 0)` return
    /// a stale/default format that doesn't match what the bus will
    /// validate against when the tap installs — which throws an
    /// uncaught `com.apple.coreaudio.avfaudio` "Failed to create tap due
    /// to format mismatch" NSException and crashes the helper.
    private func applyPinnedInputDevice() {
        guard pinnedInputDeviceID != AudioDeviceID(kAudioObjectUnknown) else {
            return
        }
        guard let auInput = audioEngine.inputNode.audioUnit else {
            stderrLog("inputNode.audioUnit is nil — cannot pin device")
            return
        }

        // Uninitialize is idempotent (no-op if already uninitialized);
        // we don't bother checking the return code.
        AudioUnitUninitialize(auInput)

        var dev = pinnedInputDeviceID
        let status = AudioUnitSetProperty(
            auInput,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &dev,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        if status != noErr {
            stderrLog("AudioUnitSetProperty(CurrentDevice=\(dev)) failed status=\(status) (0x\(String(status, radix: 16)))")
        } else {
            stderrLog("input pinned to device id=\(dev)")
        }

        let initStatus = AudioUnitInitialize(auInput)
        if initStatus != noErr {
            stderrLog("AudioUnitInitialize after pin failed status=\(initStatus) (0x\(String(initStatus, radix: 16)))")
        }
    }

    /// Install the input tap with the device's *current* format, build a
    /// matching converter, and start the engine. Factored out of
    /// `startListening` so the route-change handler can rebuild the tap
    /// without tearing down the active recognition request/task.
    /// Returns false if the input format is unusable (e.g. the device is
    /// transitioning between routes and reports a zero format) — caller
    /// can rely on the configuration-change notification to retry.
    @discardableResult
    private func installTapAndStartEngine() -> Bool {
        if installTapAndStartEngineOnce() {
            return true
        }
        // First attempt failed. Most common cause we've seen in the
        // wild is `kAudioUnitErr_FormatNotSupported` (-10868) when the
        // pinned device is a Bluetooth headset that advertises a
        // 48 kHz/Float32 stream but actually only supports lower rates
        // for input (AirPods in HFP/SCO mode). The cleanest way to
        // drop the AUHAL's device override is to rebuild the engine —
        // a fresh AVAudioEngine doesn't carry the prior CurrentDevice
        // pin. We lose mid-session route-swap protection for this
        // session, but that's strictly better than refusing to listen.
        guard pinnedInputDeviceID != AudioDeviceID(kAudioObjectUnknown) else {
            emitError("audio engine failed to start — no device pin to drop")
            return false
        }
        stderrLog("first start attempt failed — rebuilding engine without device pin and retrying")
        pinnedInputDeviceID = AudioDeviceID(kAudioObjectUnknown)
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine = AVAudioEngine()
        installConfigChangeObserver()
        if installTapAndStartEngineOnce() {
            return true
        }
        emitError("audio engine failed to start even after dropping device pin")
        return false
    }

    @discardableResult
    private func installTapAndStartEngineOnce() -> Bool {
        let inputNode = audioEngine.inputNode
        let reportedFormat = inputNode.outputFormat(forBus: 0)
        stderrLog("input format (reported): \(reportedFormat)")
        stderrLog("recognition format: \(recognitionFormat)")

        // During a route change (headphones plugging in/out, AirPods
        // switching to HFP) the input node briefly reports a zero format.
        // Installing a tap with that crashes; building a converter from it
        // returns nil and silently drops audio. Bail out — the
        // configuration-change observer will fire again with a real format.
        guard reportedFormat.sampleRate > 0, reportedFormat.channelCount > 0 else {
            stderrLog("input format invalid (sr=\(reportedFormat.sampleRate) ch=\(reportedFormat.channelCount)) — deferring tap install to next config change")
            return false
        }

        // Pass `nil` for the tap format rather than a pre-queried
        // `outputFormat(forBus:)`. After `AudioUnitUninitialize` +
        // `AudioUnitSetProperty(CurrentDevice)` — particularly when the
        // active device is a Bluetooth headset (AirPods et al.) — the
        // value `outputFormat(forBus:)` returns can be a "preferred"
        // format that doesn't actually match the bus's internal current
        // format, and `installTap` then throws the uncaught
        // `com.apple.coreaudio.avfaudio` "format mismatch" NSException
        // that crashes the helper. With `nil`, AVAudioEngine uses
        // whatever format the node has at install time and the two are
        // guaranteed to agree. We build the converter lazily from
        // `inputBuffer.format` on the first delivered buffer so the
        // converter always reflects the device's *actual* output.
        converter = nil
        let recogFormat = recognitionFormat
        inputNode.removeTap(onBus: 0)
        var bufferCount = 0
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] inputBuffer, _ in
            guard let self else { return }
            bufferCount &+= 1
            if bufferCount == 1 {
                stderrLog("first audio buffer received (\(inputBuffer.frameLength) frames, \(inputBuffer.format.channelCount)ch, \(Int(inputBuffer.format.sampleRate))Hz)")
            } else if bufferCount % 200 == 0 {
                stderrLog("audio buffers delivered: \(bufferCount)")
            }

            // First buffer in this tap → build (or rebuild) the converter
            // against the format we actually see, not the one the node
            // reported pre-install. Subsequent buffers reuse it unless the
            // format changes (route change should tear down the tap, but
            // be defensive — converters are cheap to rebuild).
            if self.converter == nil || self.converter?.inputFormat != inputBuffer.format {
                self.converter = AVAudioConverter(from: inputBuffer.format, to: recogFormat)
                if self.converter == nil {
                    stderrLog("AVAudioConverter init FAILED for input=\(inputBuffer.format) → \(recogFormat)")
                }
            }
            guard let conv = self.converter else {
                self.request?.append(inputBuffer)
                return
            }

            // Convert to mono 16kHz Float32 before feeding the recognizer.
            let outCapacity = AVAudioFrameCount(
                Double(inputBuffer.frameLength)
                    * recogFormat.sampleRate
                    / inputBuffer.format.sampleRate
                    + 32
            )
            guard let outBuffer = AVAudioPCMBuffer(pcmFormat: recogFormat, frameCapacity: outCapacity) else {
                return
            }

            var hasProvided = false
            var error: NSError?
            let status = conv.convert(to: outBuffer, error: &error) { _, outStatus in
                if hasProvided {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                hasProvided = true
                outStatus.pointee = .haveData
                return inputBuffer
            }
            if status == .error {
                if let error, bufferCount % 200 == 1 {
                    stderrLog("audio convert error: \(error.localizedDescription)")
                }
                return
            }
            self.request?.append(outBuffer)
            // VAD silence-commit is intentionally disabled for now while
            // we shake out the ctrl-tap-only commit path. Re-enable by
            // uncommenting this line; thresholds live in `processVAD`.
            // self.processVAD(outBuffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            stderrLog("audio engine started, running=\(audioEngine.isRunning)")
            return true
        } catch {
            // Logged but not surfaced as a user-visible error — the
            // caller (`installTapAndStartEngine`) may still recover via
            // the engine-rebuild fallback. Once that fallback runs and
            // also fails, the eventual `return false` chain leaves the
            // panel in an idle state and a subsequent press will retry
            // from scratch.
            stderrLog("audio engine failed to start: \(error.localizedDescription)")
            return false
        }
    }

    /// Coarse RMS gate over the mono-16 kHz recognizer buffer. Emits a
    /// one-shot `silence-timeout` event when speech has been heard at
    /// least once and the trailing silence exceeds `vadSilenceDuration`.
    /// The widget consumes the event to auto-commit a turn in active
    /// mode without waiting for Apple's much slower no-speech error.
    private func processVAD(_ buffer: AVAudioPCMBuffer) {
        if vadFiredSilenceTimeout { return }
        guard let data = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        if n == 0 { return }
        var sum: Float = 0
        for i in 0..<n {
            let s = data[i]
            sum += s * s
        }
        let rms = sqrtf(sum / Float(n))
        if rms >= Self.vadRmsThreshold {
            vadHeardSpeech = true
            vadSilenceStartedAt = nil
            return
        }
        guard vadHeardSpeech else { return }
        let now = Date()
        if vadSilenceStartedAt == nil {
            vadSilenceStartedAt = now
            return
        }
        if now.timeIntervalSince(vadSilenceStartedAt!) >= Self.vadSilenceDuration {
            vadFiredSilenceTimeout = true
            stderrLog("VAD silence \(Int(Self.vadSilenceDuration * 1000))ms — emitting silence-timeout")
            DispatchQueue.main.async {
                emit(["event": "silence-timeout"])
            }
        }
    }

    /// Fired when macOS rebuilds the audio graph — typically because the
    /// user plugged in headphones, AirPods connected/disconnected, or the
    /// default input/output device changed. Apple has already stopped the
    /// engine by the time we get here; we must re-query the (possibly
    /// new) input format, rebuild the converter, reinstall the tap, and
    /// restart. Skipped when we're not currently listening.
    /// Coalesce a flurry of route-change notifications into a single
    /// rebuild. Apple posts the notification on `.main`, so this runs
    /// serialized — no lock needed.
    private func scheduleRouteRebuild() {
        pendingRouteRebuild?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.pendingRouteRebuild = nil
            self?.handleConfigurationChange()
        }
        pendingRouteRebuild = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    private func handleConfigurationChange() {
        // Only rebuild if the user is *actively* listening. After
        // `stopListening` we still hold a non-nil `request` until the
        // recognizer drains (hasEndAudioed=true bridges that window),
        // and a config-change in that window must NOT restart capture
        // — the user has already released the hotkey.
        guard request != nil, !hasEndAudioed else {
            stderrLog("audio config changed while idle/stopping — ignoring (request=\(request != nil), hasEndAudioed=\(hasEndAudioed))")
            return
        }
        stderrLog("audio config changed mid-session (likely headphones plug/unplug) — rebuilding tap")

        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }

        // Re-assert the pinned device. If the device the user started the
        // session on is gone (they actually unplugged it), fall back to
        // the new system default rather than refusing to listen at all.
        if pinnedInputDeviceID != AudioDeviceID(kAudioObjectUnknown)
            && !deviceStillExists(pinnedInputDeviceID) {
            stderrLog("pinned device id=\(pinnedInputDeviceID) is gone — falling back to current default")
            pinnedInputDeviceID = currentDefaultInputDevice() ?? AudioDeviceID(kAudioObjectUnknown)
        }
        applyPinnedInputDevice()

        if !installTapAndStartEngine() {
            // Format wasn't usable yet — the OS sometimes posts a second
            // notification once the new device finishes coming up. Try
            // once more after a short grace period; if that also fails,
            // give up and let the next route change retry.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                guard let self, self.request != nil, !self.audioEngine.isRunning else { return }
                _ = self.installTapAndStartEngine()
            }
        }
    }

    // -------- speaking --------

    func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        // AVSpeechUtterance accepts 0.0–1.0 (Slow…Default…Fast); 0.5 is
        // Apple's documented default. We sit slightly below it so spoken
        // replies stay legible during multi-sentence progress narration
        // — easier to follow than a brisk 0.55, and still natural.
        utterance.rate = 0.48
        if let voice = preferredVoice() {
            utterance.voice = voice
        }
        synthesizer.speak(utterance)
    }

    func cancelSpeech() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    private func preferredVoice() -> AVSpeechSynthesisVoice? {
        if let id = preferredVoiceIdentifier,
           let voice = AVSpeechSynthesisVoice(identifier: id) {
            return voice
        }
        let voices = AVSpeechSynthesisVoice.speechVoices()
        // Prefer Enhanced English voices over Compact. (Premium tier
        // exists on macOS 13+ but Enhanced is plenty good and works on
        // older OSes.)
        let enhanced = voices.first { v in
            v.language.hasPrefix("en") && v.quality == .enhanced
        }
        if let enhanced { return enhanced }
        if #available(macOS 13.0, *) {
            if let premium = voices.first(where: { v in
                v.language.hasPrefix("en") && v.quality == .premium
            }) {
                return premium
            }
        }
        return AVSpeechSynthesisVoice(language: "en-US")
    }

    func setPreferredVoice(_ identifier: String) {
        stderrLog("setPreferredVoice = \(identifier)")
        preferredVoiceIdentifier = identifier
    }

    /// Enumerate all installed voices and emit them as a `voices` event.
    /// Filtered to English locales; quality reported as a coarse string
    /// the React UI can show ("default", "enhanced", "premium").
    func listVoices() {
        let voices = AVSpeechSynthesisVoice.speechVoices()
        let payload: [[String: Any]] = voices
            .filter { $0.language.hasPrefix("en") }
            .map { v in
                [
                    "identifier": v.identifier,
                    "name": v.name,
                    "language": v.language,
                    "quality": Self.qualityString(v.quality),
                ]
            }
        emit(["event": "voices", "voices": payload])
    }

    private static func qualityString(_ q: AVSpeechSynthesisVoiceQuality) -> String {
        if #available(macOS 13.0, *) {
            if q == .premium { return "premium" }
        }
        if q == .enhanced { return "enhanced" }
        return "default"
    }

    // -------- AVSpeechSynthesizerDelegate --------

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        emit(["event": "tts-started"])
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        emit(["event": "tts-ended"])
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        emit(["event": "tts-ended"])
    }
}

// ------------------------------------------------------------------
// stdin command loop
// ------------------------------------------------------------------

let controller = VoiceController()
emit(["event": "ready"])
stderrLog("helper started, pid=\(getpid())")

let stdinHandle = FileHandle.standardInput
var stdinBuffer = Data()

// readabilityHandler integrates with the main run loop — more robust
// than a polling background thread. EOF still triggers exit, but
// transient empty reads (which can happen on macOS pipes) don't.
stdinHandle.readabilityHandler = { handle in
    let chunk = handle.availableData
    if chunk.isEmpty {
        // EOF — parent closed stdin
        stderrLog("stdin EOF, exiting")
        DispatchQueue.main.async { exit(0) }
        return
    }
    stdinBuffer.append(chunk)
    while let nl = stdinBuffer.firstIndex(of: 0x0A) {
        let lineData = stdinBuffer.subdata(in: 0..<nl)
        stdinBuffer.removeSubrange(0...nl)
        DispatchQueue.main.async { handleLine(lineData) }
    }
}

func handleLine(_ data: Data) {
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        stderrLog("malformed stdin line (\(data.count) bytes)")
        return
    }
    guard let cmd = obj["cmd"] as? String else {
        stderrLog("missing cmd field")
        return
    }

    stderrLog("cmd=\(cmd)")
    switch cmd {
    case "request_permissions":
        controller.requestPermissions()
    case "start_listening":
        controller.startListening()
    case "stop_listening":
        controller.stopListening()
    case "cancel_listening":
        controller.cancelListening()
    case "speak":
        if let text = obj["text"] as? String, !text.isEmpty {
            controller.speak(text)
        }
    case "cancel_speech":
        controller.cancelSpeech()
    case "list_voices":
        controller.listVoices()
    case "set_voice":
        if let id = obj["identifier"] as? String, !id.isEmpty {
            controller.setPreferredVoice(id)
        }
    default:
        emitError("unknown cmd: \(cmd)")
    }
}

RunLoop.main.run()
