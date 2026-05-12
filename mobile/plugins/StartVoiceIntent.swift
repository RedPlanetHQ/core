import AppIntents
import Foundation
import UIKit

@available(iOS 16.0, *)
struct StartVoiceIntent: AppIntent {
    static var title: LocalizedStringResource = "Start CORE Voice"
    static var description = IntentDescription("Opens CORE and immediately starts listening.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // openAppWhenRun brings the app to the foreground; the URL open then
        // routes through the app's URL scheme handler so the JS side picks
        // it up via `expo-linking` and starts a listening session.
        if let url = URL(string: "core://voice-start") {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct CoreAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartVoiceIntent(),
            phrases: [
                "Start voice in \(.applicationName)",
                "Talk to \(.applicationName)",
                "Open voice on \(.applicationName)"
            ],
            shortTitle: "Start Voice",
            systemImageName: "mic.fill"
        )
    }
}
