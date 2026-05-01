import Foundation
import AVFoundation
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
    private let audioEngine = AVAudioEngine()
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

    override init() {
        super.init()
        synthesizer.delegate = self
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

        // NOTE: deliberately not calling setVoiceProcessingEnabled —
        // it inserts AEC reference channels into the buffer that the
        // recognizer can't parse. We instead convert whatever the
        // device gives us into mono 16kHz Float32 in the tap callback.
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        stderrLog("input format: \(inputFormat)")
        stderrLog("recognition format: \(recognitionFormat)")
        converter = AVAudioConverter(from: inputFormat, to: recognitionFormat)
        if converter == nil {
            stderrLog("AVAudioConverter init FAILED for these formats")
        }
        let conv = converter
        let recogFormat = recognitionFormat
        inputNode.removeTap(onBus: 0)
        var bufferCount = 0
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] inputBuffer, _ in
            guard let self else { return }
            bufferCount &+= 1
            if bufferCount == 1 {
                stderrLog("first audio buffer received (\(inputBuffer.frameLength) frames, \(inputBuffer.format.channelCount)ch)")
            } else if bufferCount % 200 == 0 {
                stderrLog("audio buffers delivered: \(bufferCount)")
            }

            guard let conv else {
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
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            stderrLog("audio engine started, running=\(audioEngine.isRunning)")
        } catch {
            emitError("audio engine failed: \(error.localizedDescription)")
            return
        }

        lastEmittedFinalText = ""
        latestPartialText = ""
        hasEndAudioed = false
        hasDeliveredFinal = false
        if !internalRestart {
            preservedPrefix = ""
        }
        stderrLog("creating recognition task (preservedPrefix=\(preservedPrefix.count) chars)")
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let raw = result.bestTranscription.formattedString
                let combined = self.combineWithPrefix(raw)
                self.latestPartialText = combined
                if result.isFinal {
                    if self.hasEndAudioed {
                        // User released keys → commit.
                        self.deliverFinalIfNeeded(combined)
                    } else {
                        // Recognizer decided we're done mid-hold (e.g.
                        // long pause). User is still holding keys, so
                        // preserve what we have and start a fresh task
                        // so they can keep talking.
                        DispatchQueue.main.async {
                            stderrLog("recognizer isFinal mid-session — preserving \(combined.count) chars and restarting")
                            self.cancelListening()
                            self.preservedPrefix = combined
                            self.startListening(internalRestart: true)
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
                        stderrLog("recognizer no-speech mid-session — preserving \(saved.count) chars and restarting")
                        self.cancelListening()
                        self.preservedPrefix = saved
                        self.startListening(internalRestart: true)
                    }
                } else if !isNoSpeech {
                    emitError("recognition: \(error.localizedDescription)")
                }
            }
        }
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
        guard !hasDeliveredFinal else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
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

    /// Hard-cancel — used when the user dismisses the widget without
    /// wanting a final transcript.
    func cancelListening() {
        stderrLog("cancelListening")
        fallbackFinalWorkItem?.cancel()
        fallbackFinalWorkItem = nil
        hasDeliveredFinal = true // suppress any late callback
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
    }

    private func armFinalFallback() {
        fallbackFinalWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            // If the recognizer hasn't called back within the window,
            // commit the latest partial as the final transcript.
            self.deliverFinalIfNeeded(self.latestPartialText)
        }
        fallbackFinalWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: work)
    }

    // -------- speaking --------

    func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        // Default rate (0.5) feels noticeably slow. 0.55 is a natural
        // conversation pace without sounding rushed; AVSpeechUtterance
        // accepts 0.0–1.0 (Slow…Default…Fast).
        utterance.rate = 0.55
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
