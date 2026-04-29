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

    func startListening() {
        guard let recognizer, recognizer.isAvailable else {
            emitError("speech recognizer unavailable in this locale")
            return
        }

        if audioEngine.isRunning {
            // already listening; ignore
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(macOS 10.15, *) {
            req.requiresOnDeviceRecognition = true
        }
        request = req

        let inputNode = audioEngine.inputNode
        // Voice processing on the input node gives us hardware-grade echo
        // cancellation + noise suppression on macOS 13+. Older OSes fall back
        // silently — barge-in then relies on the 3-word partial filter
        // applied by the frontend.
        if #available(macOS 13.0, *) {
            do {
                try inputNode.setVoiceProcessingEnabled(true)
            } catch {
                // non-fatal — keep going without echo cancel
            }
        }

        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            emitError("audio engine failed: \(error.localizedDescription)")
            return
        }

        lastEmittedFinalText = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    if !text.isEmpty && text != self.lastEmittedFinalText {
                        self.lastEmittedFinalText = text
                        emit(["event": "final", "text": text])
                    }
                } else {
                    emit(["event": "partial", "text": text, "isFinal": false])
                }
            }
            if let error = error as NSError? {
                // 203 / kAFAssistantErrorDomain "no speech detected" is benign
                if error.code != 203 {
                    emitError("recognition: \(error.localizedDescription)")
                }
            }
        }
    }

    func stopListening() {
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
    }

    // -------- speaking --------

    func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        // Prefer a Premium voice if installed; AVSpeechSynthesisVoice picks
        // the default for the user's region otherwise.
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

let stdinHandle = FileHandle.standardInput

DispatchQueue.global(qos: .userInteractive).async {
    var buffer = Data()
    while true {
        let chunk = stdinHandle.availableData
        if chunk.isEmpty {
            // stdin closed → parent died → exit
            exit(0)
        }
        buffer.append(chunk)

        while let nl = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer.subdata(in: 0..<nl)
            buffer.removeSubrange(0...nl)
            handleLine(lineData)
        }
    }
}

func handleLine(_ data: Data) {
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    guard let cmd = obj["cmd"] as? String else { return }

    switch cmd {
    case "request_permissions":
        controller.requestPermissions()
    case "start_listening":
        DispatchQueue.main.async { controller.startListening() }
    case "stop_listening":
        DispatchQueue.main.async { controller.stopListening() }
    case "speak":
        if let text = obj["text"] as? String, !text.isEmpty {
            DispatchQueue.main.async { controller.speak(text) }
        }
    case "cancel_speech":
        DispatchQueue.main.async { controller.cancelSpeech() }
    default:
        emitError("unknown cmd: \(cmd)")
    }
}

RunLoop.main.run()
