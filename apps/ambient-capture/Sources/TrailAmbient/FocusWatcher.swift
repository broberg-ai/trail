// F201.3 — app/window focus capture (the cheapest, most precise signal).
//
// NSWorkspace.didActivateApplicationNotification gives app switches;
// AXUIElement gives the focused window's title (requires the Accessibility
// TCC permission). Events are debounced and appended as JSON lines to
// ~/Library/Logs/TrailAmbient/focus.jsonl — the local buffer the F201.4
// gate consumes. Nothing here ever leaves the machine.
import AppKit
import ApplicationServices

struct FocusEvent: Codable {
    let app: String
    let windowTitle: String?
    let ts: String
}

@MainActor
final class FocusWatcher {
    var paused = false
    private var observer: NSObjectProtocol?
    private var debounceTimer: Timer?

    static func promptForAccessibilityIfNeeded() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    func start() {
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            let name = app.localizedName ?? "Unknown"
            let pid = app.processIdentifier
            Task { @MainActor [weak self] in
                self?.appDidActivate(name: name, pid: pid)
            }
        }
        // Surface the Accessibility trust state in the log so a missing
        // grant is diagnosable from focus.jsonl instead of guessed at.
        // NB: an ad-hoc re-signed rebuild gets a new code identity, so a
        // previously given grant silently detaches — the log tells you.
        EventLog.shared.log(kind: AXIsProcessTrusted() ? "watcher_started_trusted" : "watcher_started_untrusted")
    }

    /// Test hook (F201.3 verification) — runs the exact same gate the
    /// NSWorkspace notification does, so the pause behaviour can be proven
    /// headless without driving the menubar. pid 0 → no window-title lookup.
    func simulateActivation(name: String) {
        appDidActivate(name: name, pid: 0)
    }

    private func appDidActivate(name: String, pid: pid_t) {
        guard !paused else { return }
        // Debounce rapid ⌘-tabbing: only the app the user SETTLES on within
        // 300 ms becomes an event.
        debounceTimer?.invalidate()
        debounceTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
            Task { @MainActor in
                let title = Self.focusedWindowTitle(pid: pid)
                let event = FocusEvent(
                    app: name,
                    windowTitle: title,
                    ts: ISO8601DateFormatter().string(from: Date())
                )
                EventLog.shared.append(event)
            }
        }
    }

    /// Focused window title via the Accessibility API. Returns nil without
    /// the TCC permission (the event still logs with the app name alone).
    private static func focusedWindowTitle(pid: pid_t) -> String? {
        let appElement = AXUIElementCreateApplication(pid)
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &window) == .success,
              let window else { return nil }
        var title: CFTypeRef?
        // CFTypeRef from AX is always an AXUIElement for focusedWindow.
        guard AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else {
            return nil
        }
        return title as? String
    }
}

/// Append-only JSONL log — the verification anchor for the F201.3 AC
/// ("a logged session captures ≥3 app switches") and the local hand-off
/// point to the gate.
@MainActor
final class EventLog {
    static let shared = EventLog()
    private let url: URL

    private init() {
        // TRAIL_AMBIENT_LOG override keeps --selftest OFF the production
        // capture log (a selftest event once leaked a "ResumedApp" row into
        // a real ambient candidate, 2026-07-02). The relay honours the same
        // env var so both sides stay in sync.
        if let override = ProcessInfo.processInfo.environment["TRAIL_AMBIENT_LOG"] {
            url = URL(fileURLWithPath: override)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        } else {
            let dir = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Logs/TrailAmbient", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            url = dir.appendingPathComponent("focus.jsonl")
        }
    }

    func append(_ event: FocusEvent) {
        guard let data = try? JSONEncoder().encode(event), let line = String(data: data, encoding: .utf8) else { return }
        write(line)
    }

    func log(kind: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        write(#"{"event":"\#(kind)","ts":"\#(ts)"}"#)
    }

    private func write(_ line: String) {
        let payload = line + "\n"
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(payload.utf8))
        } else {
            try? Data(payload.utf8).write(to: url)
        }
        print(line)
    }
}
