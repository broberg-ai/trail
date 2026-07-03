// F201.15 — Prompt Mode: the app's second purpose. Instead of saving dictation
// to Trail (Extraction mode), Prompt Mode relays it straight into the cc-session
// the user is looking at. This file is STEP 1 (read-only): the mode toggle + the
// live-resolving Target, surfaced as a label in the HUD footer. The relay/send is
// wired in step 2 — ONLY after the resolver is proven correct on real tab titles,
// so a mis-resolved target can never fire a prompt at the wrong agent.
//
// Target resolution follows focus in REAL TIME (Christian 2026-07-03: "runtime
// automatisk udskifte modtageren efter hvad du tracker af app/tab"). App switches
// fire NSWorkspace notifications, but TAB switches within one app (e.g. iTerm)
// do NOT — so a poll re-reads the frontmost app's focused-window title on a timer
// to catch tab changes too. The HUD itself becomes frontmost when shown
// (NSApp.activate), so the poll IGNORES Trail Ambient's own bundle id and keeps
// the last EXTERNAL target — the app focused just before the HUD opened.
import AppKit

@MainActor
final class PromptMode: ObservableObject {
    static let shared = PromptMode()

    private static let ownBundleId = "com.broberg.trail-ambient"
    private static let defaultsKey = "trail.promptMode"
    private static let autoEnterKey = "trail.promptAutoEnter"

    /// Extraction (false) vs Prompt (true). Persisted across launches.
    @Published var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: Self.defaultsKey)
            enabled ? startPolling() : stopPolling()
        }
    }

    /// The app the target resolves from (last external frontmost app).
    @Published private(set) var targetApp: String = ""
    /// The raw focused-window title of that app (what the resolver reads).
    @Published private(set) var rawTitle: String? = nil
    /// The resolved cc-session name (iTerm tab). nil for a browser page — but
    /// injection doesn't need it (it types into whatever field has focus).
    @Published private(set) var session: String? = nil
    /// The app the dictation injects into — re-activated on send (the HUD stole
    /// focus when it opened, so we restore the target's focus before pasting).
    private(set) var targetRunningApp: NSRunningApplication?
    /// Synthesize Return after injecting (auto-send)? Persisted; default OFF —
    /// inject the text and let the user press Enter (review-first).
    @Published var autoEnter: Bool {
        didSet { UserDefaults.standard.set(autoEnter, forKey: Self.autoEnterKey) }
    }

    private var pollTimer: Timer?

    private init() {
        enabled = UserDefaults.standard.bool(forKey: Self.defaultsKey)
        autoEnter = UserDefaults.standard.bool(forKey: Self.autoEnterKey)
        if enabled { startPolling() }
    }

    // MARK: Focus tracking

    /// Called by FocusWatcher on every app activation — the immediate path so an
    /// app switch updates the target without waiting for the next poll tick.
    func noteActivation(app: String, pid: pid_t, bundleId: String?) {
        guard enabled, bundleId != Self.ownBundleId else { return }
        update(runningApp: NSRunningApplication(processIdentifier: pid),
               title: FocusWatcher.focusedWindowTitle(pid: pid))
    }

    private func startPolling() {
        stopPolling()
        refresh()
        // 1 s catches tab switches (which fire no app-activation event) without
        // being a busy-loop. Only runs while Prompt Mode is on.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Read the current frontmost EXTERNAL app + its focused window title and
    /// re-resolve the target. When Trail Ambient itself is frontmost (HUD open),
    /// keep the last external target rather than resolving to ourselves.
    private func refresh() {
        guard let front = NSWorkspace.shared.frontmostApplication,
              front.bundleIdentifier != Self.ownBundleId else { return }
        update(runningApp: front, title: FocusWatcher.focusedWindowTitle(pid: front.processIdentifier))
    }

    private func update(runningApp: NSRunningApplication?, title: String?) {
        targetRunningApp = runningApp
        targetApp = runningApp?.localizedName ?? ""
        rawTitle = title
        // Session-name resolution ONLY makes sense for iTerm, where the TAB title
        // IS the session name. For a browser the session tab lives INSIDE the web
        // page, not the window title — resolving from the title gives a wrong
        // guess (showed "cms" while the active tab was "trail", Christian
        // 2026-07-03). For non-iTerm apps we show the app name; injection goes to
        // the focused field regardless of which session the page is showing.
        let isITerm = runningApp?.bundleIdentifier == "com.googlecode.iterm2"
        session = isITerm ? Self.resolveSession(from: title) : nil
    }

    // MARK: Send — inject into the focused field

    /// Deliver the dictation by typing it into the target app's focused field.
    /// Re-activates the target (the HUD stole focus on open), lets focus settle,
    /// then pastes + optionally presses Return. Universal: works in the cardmem
    /// Agents composer, iTerm, Slack, a doc — wherever the cursor was.
    func inject(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let enter = autoEnter
        let appName = targetApp
        targetRunningApp?.activate(options: [])
        // Let focus land back in the target field before pasting.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            TextInjector.inject(trimmed, pressEnter: enter)
        }
        EventLog.shared.log(kind: "prompt_inject app=\(appName) enter=\(enter) chars=\(trimmed.count)")
    }

    // MARK: Resolution (title -> session name)

    /// v1 heuristic: the LEADING run of session-name characters (a–z, 0–9,
    /// hyphen) in the lowercased title, stopping at the first decoration (space,
    /// ⌘7, — 80×24, …). Session names contain hyphens — `fd-sundhed`,
    /// `sanne-andersen`, `broberg-ai-site` — so we must NOT split on them (that
    /// gave "fd" for the "fd-sundhed ⌘7" tab, Christian 2026-07-03). An iTerm tab
    /// named after a session surfaces as "<name> ⌘N" / "<name> — 80×24".
    /// Deliberately transparent: the HUD footer shows BOTH the raw title and this
    /// resolved value so the mapping is validated by eye before step 2 wires the
    /// send. (Step 2 hardens this against the buddycloud session roster.)
    static func resolveSession(from title: String?) -> String? {
        guard let title else { return nil }
        var result = ""
        var started = false
        for ch in title.lowercased() {
            if ch.isLetter || ch.isNumber || ch == "-" {
                result.append(ch)
                started = true
            } else if started {
                break   // decoration after the name → stop
            }
            // leading non-name chars (numbering, symbols) are skipped
        }
        result = result.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return result.count >= 2 ? result : nil
    }
}
