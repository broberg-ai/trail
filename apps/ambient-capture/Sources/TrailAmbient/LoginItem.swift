// F201.20 — "Start at login". Trail Ambient is a background capture agent, so a
// Mac restart must not quietly end it (2026-08-19: it had, for six weeks — the
// app had never had ANY autostart, it only ever ran because a session had just
// launched it by hand).
//
// Registration goes through SMAppService (macOS 13+; our minimum is 14.0), which
// puts the item in System Settings › General › Login Items where the owner can
// see and revoke it. A LaunchAgent plist would work too, but two mechanisms
// would double-launch the app — one, visible to the owner, is the right count.
//
// The OS is the source of truth for the menu checkmark (`isEnabled` asks
// SMAppService every time), so revoking it in System Settings shows up in the
// menu instead of a stale cached boolean. UserDefaults stores only the owner's
// INTENT — that is what tells "never decided" apart from "deliberately off", and
// what lets us repair the registration after a rebuild.
import Foundation
import ServiceManagement

/// Main-actor isolated: every call site is the menubar, the launch hook, or the
/// CLI entry point — all already on the main thread — and EventLog is too.
@MainActor
enum LoginItem {
    /// The owner's intent. Absent = never decided.
    private static let intentKey = "trail.ambient.launchAtLogin"

    /// OS truth, re-read on every access — never a cached flag.
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    private static var decided: Bool {
        UserDefaults.standard.object(forKey: intentKey) != nil
    }

    private static var wants: Bool { UserDefaults.standard.bool(forKey: intentKey) }

    /// Register / unregister, record the intent, and return the resulting OS state.
    @discardableResult
    static func setEnabled(_ on: Bool) -> Bool {
        UserDefaults.standard.set(on, forKey: intentKey)
        do {
            if on {
                if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            EventLog.shared.log(kind: "login_item_error want=\(on) err=\(error.localizedDescription)")
        }
        let now = isEnabled
        EventLog.shared.log(kind: "login_item_set want=\(on) enabled=\(now)")
        return now
    }

    /// Called at launch. First run opts in — a background agent the owner has to
    /// start by hand isn't one. Every later run only REPAIRS: `scripts/bundle.sh`
    /// does `rm -rf` on the bundle and recreates it, which can invalidate the
    /// registration, so re-register when the intent is on but the OS lost it.
    /// An owner who turned it off is never overridden.
    static func syncAtLaunch() {
        guard decided else { setEnabled(true); return }
        if wants && !isEnabled { setEnabled(true) }
    }

    /// `--loginitem <on|off|status>` — the headless harness (same convention as
    /// --selftest / --neuraltest). Exists so the registration can be verified
    /// from a SEPARATE process: the app reporting "enabled" from its own memory
    /// proves nothing, a fresh process reading it back from the OS does.
    static func runCLI(_ arg: String) -> Never {
        switch arg {
        case "on":  _ = setEnabled(true)
        case "off": _ = setEnabled(false)
        case "status": break
        default:
            print("usage: --loginitem <on|off|status>")
            exit(2)
        }
        let status = SMAppService.mainApp.status
        let name: String
        switch status {
        case .enabled:          name = "enabled"
        case .notRegistered:    name = "notRegistered"
        case .notFound:         name = "notFound"
        case .requiresApproval: name = "requiresApproval"
        @unknown default:       name = "unknown(\(status.rawValue))"
        }
        print("login item: \(name)   intent: \(decided ? (wants ? "on" : "off") : "undecided")")
        print("bundle: \(Bundle.main.bundleURL.path)")
        exit(status == .enabled ? 0 : 1)
    }
}
