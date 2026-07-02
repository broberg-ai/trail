// F201.3 verification — headless proof of the pause gate, invoked with
// `TrailAmbient --selftest`. macOS TCC (Accessibility, Screen Recording)
// requires a human to approve prompts in System Settings, so the menubar
// render, window-title capture, and menu-driven pause can only be verified
// interactively. This gate — "a paused watcher emits zero events, a running
// one emits" — is the part we CAN prove deterministically, no clicks.
import AppKit

@MainActor
enum SelfTest {
    static func run() -> Never {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/TrailAmbient", isDirectory: true)
        let logURL = dir.appendingPathComponent("focus.jsonl")
        try? FileManager.default.removeItem(at: logURL)

        let watcher = FocusWatcher()

        // Paused → activation must be ignored.
        watcher.paused = true
        watcher.simulateActivation(name: "PausedApp")
        pump(0.5)

        // Resumed → activation must be captured.
        watcher.paused = false
        watcher.simulateActivation(name: "ResumedApp")
        pump(0.5)

        let contents = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
        let sawPaused = contents.contains("\"app\":\"PausedApp\"")
        let sawResumed = contents.contains("\"app\":\"ResumedApp\"")

        print("SELFTEST paused_emitted=\(sawPaused) resumed_emitted=\(sawResumed)")
        let ok = !sawPaused && sawResumed
        print(ok ? "SELFTEST PASS" : "SELFTEST FAIL")
        exit(ok ? 0 : 1)
    }

    /// Spin the run loop so the watcher's debounce Timer can fire.
    private static func pump(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}
