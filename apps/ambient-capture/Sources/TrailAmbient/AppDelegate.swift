// F201.3 — menubar status item + app lifecycle.
//
// The status item is the product's transparency contract: it always shows
// whether the agent is capturing (●) or paused (॥), which Trail account the
// device is connected to, and is the entry point for settings. LSUIElement/
// .accessory means this is the ONLY visible surface.
import AppKit
import Carbon.HIToolbox

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let focusWatcher = FocusWatcher()
    private let deviceAuth = DeviceAuth()
    private let hud = HudController()
    private var paused = false {
        didSet { render() }
    }

    // Cached account avatar. Fetched ONCE via ensureAvatar(); buildMenu only
    // ever READS this. (The first version fetched inside buildMenu and called
    // render() from the callback — once the avatar was cached the callback
    // ran synchronously, so render→buildMenu→render recursed until the stack
    // overflowed and the app crashed the instant it connected. 2026-07-02.)
    private var avatarImage: NSImage?
    private var avatarFetching = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        installEditMenu()
        render()
        // TCC: prompt for Accessibility on first run — required for window
        // titles via AXUIElement. The system remembers the answer.
        FocusWatcher.promptForAccessibilityIfNeeded()
        // TCC: prompt for Screen Recording (F201.5 screen OCR). Ships dark
        // until granted — capture returns nil, window titles still flow.
        ScreenWatcher.requestScreenRecordingIfNeeded()
        focusWatcher.start()
        // Mic TCC. The actual grant flows through the HUD mic button / ⌃⌥R, where
        // the app is frontmost so the system prompt reliably appears (an accessory
        // app's launch-time prompt does not). ⌃⌥R capture-now lives on the HUD now
        // (HudController) so it opens the HUD + shows the transcript, like the button.
        AudioWatcher.requestMicIfNeeded()
        // Pre-warm Whisper in the background so the first capture doesn't wait on
        // the one-time model download.
        Task { await Whisper.shared.prewarm() }
        // F201.13 — refresh the KB name from the engine so the menubar "writing to"
        // label reflects a rename in admin (cached name is only set at connect time).
        Task {
            if await TrailClient.refreshKbName() != nil {
                await MainActor.run { self.render() }
            }
        }
    }

    /// F201.9 fix — the HUD search field couldn't paste (⌘V). An .accessory
    /// (LSUIElement) app has no main menu, and macOS delivers the standard
    /// editing shortcuts (⌘X/⌘C/⌘V/⌘A, ⌘Z) via the Edit menu's key equivalents.
    /// Without an Edit menu those events never reach the SwiftUI TextField's
    /// field editor — typing worked (direct key events) but paste didn't.
    /// Installing this minimal Edit menu wires the responder-chain routing; an
    /// accessory app shows no menu bar, so nothing appears on screen.
    private func installEditMenu() {
        let mainMenu = NSMenu()
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        editItem.submenu = edit
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = mainMenu
    }

    private func render() {
        // Trail mark instead of a text glyph — accent core FILLED while
        // capturing, OUTLINE while paused (the visible recording tell).
        statusItem.button?.image = TrailMark.menubarImage(filled: !paused)
        statusItem.button?.title = ""
        statusItem.button?.toolTip = paused ? S.tooltipPaused : S.tooltipActive
        statusItem.menu = buildMenu()
        ensureAvatar()
    }

    /// Fetch the account gravatar at most ONCE. Idempotent + guarded, so a
    /// cached (synchronous) callback can safely call render() again without
    /// re-triggering a fetch → no recursion.
    private func ensureAvatar() {
        guard deviceAuth.isConnected, avatarImage == nil, !avatarFetching,
              let email = deviceAuth.accountEmail else { return }
        avatarFetching = true
        Gravatar.avatar(for: email) { [weak self] img in
            guard let self else { return }
            self.avatarImage = img
            self.avatarFetching = false
            self.render()
        }
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        // ── Connected-account header (Tailscale/TrailScape style) ──────────
        if deviceAuth.isConnected {
            let header = NSMenuItem(title: deviceAuth.accountLabel, action: nil, keyEquivalent: "")
            header.isEnabled = false
            if let email = deviceAuth.accountEmail {
                header.attributedTitle = accountAttributed(
                    primary: deviceAuth.accountLabel,
                    secondary: deviceAuth.tenantLabel ?? email
                )
                // Read the cached avatar only — the fetch is owned by
                // ensureAvatar() so buildMenu never triggers a render loop.
                header.image = avatarImage
            }
            menu.addItem(header)
            if let kb = deviceAuth.kbLabel {
                let kbItem = NSMenuItem(title: "\(S.writingToPrefix) \(kb)", action: nil, keyEquivalent: "")
                kbItem.isEnabled = false
                menu.addItem(kbItem)
            }
            menu.addItem(.separator())
        }

        let state = NSMenuItem(
            title: paused ? S.statePaused : S.stateActive,
            action: nil, keyEquivalent: ""
        )
        state.isEnabled = false
        menu.addItem(state)

        if !deviceAuth.isConnected {
            let statusText: String
            switch deviceAuth.state {
            case .waiting: statusText = S.waitingApproval
            default: statusText = S.notConnected
            }
            let account = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
            account.isEnabled = false
            menu.addItem(account)
        }
        menu.addItem(.separator())

        if deviceAuth.isConnected {
            let lookup = NSMenuItem(title: S.lookUpInTrail, action: #selector(openHud), keyEquivalent: "t")
            lookup.keyEquivalentModifierMask = [.control, .option]
            lookup.target = self
            menu.addItem(lookup)
            menu.addItem(.separator())
        }

        let pause = NSMenuItem(
            title: paused ? S.resumeCapture : S.pauseCapture,
            action: #selector(togglePause), keyEquivalent: "p"
        )
        pause.target = self
        menu.addItem(pause)

        if !deviceAuth.isConnected {
            let connect = NSMenuItem(
                title: deviceAuth.state == .waiting ? S.reopenApproval : S.connectToTrail,
                action: #selector(connectToTrail), keyEquivalent: ""
            )
            connect.target = self
            menu.addItem(connect)
        }

        // F201.15 — Prompt Mode toggle. Off = Extraction (dictation → Trail).
        // On = dictation relays to the focused cc-session. The live target is
        // shown here + in the HUD footer so a mis-send is visibly impossible.
        menu.addItem(.separator())
        let promptItem = NSMenuItem(title: S.promptModeItem, action: #selector(togglePromptMode), keyEquivalent: "")
        promptItem.target = self
        promptItem.state = PromptMode.shared.enabled ? .on : .off
        menu.addItem(promptItem)
        if PromptMode.shared.enabled {
            let t = PromptMode.shared.session ?? (PromptMode.shared.targetApp.isEmpty ? "—" : PromptMode.shared.targetApp)
            let target = NSMenuItem(title: "  \(S.targetPrefix) \(t)", action: nil, keyEquivalent: "")
            target.isEnabled = false
            menu.addItem(target)
            let autoEnter = NSMenuItem(title: "  \(S.autoEnter)", action: #selector(toggleAutoEnter), keyEquivalent: "")
            autoEnter.target = self
            autoEnter.state = PromptMode.shared.autoEnter ? .on : .off
            menu.addItem(autoEnter)
        }

        // Settings — deny-list is enforced by the gate from F201.4; the
        // submenu makes today's defaults visible where users expect them.
        let settingsMenu = NSMenu()
        let denyHeader = NSMenuItem(title: S.denyHeader, action: nil, keyEquivalent: "")
        denyHeader.isEnabled = false
        settingsMenu.addItem(denyHeader)
        for app in Settings.denyList {
            let item = NSMenuItem(title: "  \(app)", action: nil, keyEquivalent: "")
            item.isEnabled = false
            settingsMenu.addItem(item)
        }
        // F201.5 — screen-OCR grant status (a visible recording-indicator, and
        // a one-glance diagnosis of a missing Screen Recording permission).
        settingsMenu.addItem(.separator())
        let ocrStatus = NSMenuItem(
            title: ScreenWatcher.isScreenRecordingGranted ? S.ocrActive : S.ocrNeedsPermission,
            action: nil, keyEquivalent: ""
        )
        ocrStatus.isEnabled = false
        settingsMenu.addItem(ocrStatus)
        if deviceAuth.isConnected {
            settingsMenu.addItem(.separator())
            let disconnect = NSMenuItem(
                title: S.disconnect,
                action: #selector(disconnectFromTrail), keyEquivalent: ""
            )
            disconnect.target = self
            settingsMenu.addItem(disconnect)
        }
        let settings = NSMenuItem(title: S.settings, action: nil, keyEquivalent: "")
        menu.addItem(settings)
        menu.setSubmenu(settingsMenu, for: settings)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: S.quit, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        return menu
    }

    /// Two-line account header — name in bold, tenant/email subdued beneath
    /// (the Tailscale/TrailScape look Christian pointed at).
    private func accountAttributed(primary: String, secondary: String) -> NSAttributedString {
        let s = NSMutableAttributedString(
            string: primary,
            attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.labelColor]
        )
        s.append(NSAttributedString(
            string: "\n\(secondary)",
            attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]
        ))
        return s
    }

    @objc private func openHud() { hud.toggle() }

    @objc private func togglePause() {
        paused.toggle()
        focusWatcher.paused = paused
        EventLog.shared.log(kind: paused ? "capture_paused" : "capture_resumed")
    }

    @objc private func togglePromptMode() {
        PromptMode.shared.enabled.toggle()
        EventLog.shared.log(kind: PromptMode.shared.enabled ? "prompt_mode_on" : "prompt_mode_off")
        render()
    }

    @objc private func toggleAutoEnter() {
        PromptMode.shared.autoEnter.toggle()
        render()
    }

    @objc private func connectToTrail() {
        deviceAuth.beginConnect { [weak self] in
            self?.render()
        }
    }

    @objc private func disconnectFromTrail() {
        deviceAuth.disconnect()
        avatarImage = nil
        render()
    }
}

enum Settings {
    /// Default per-app deny-list (F201 privacy rule). Enforcement happens in
    /// the gate (F201.4); user-editable list is F201.4+ scope.
    static let denyList = ["1Password", "Banking", "Messages", "Signal"]

    /// Same case-insensitive substring match as the TS relay's isDenyListed —
    /// used by ScreenWatcher (F201.5) to skip capturing deny-listed apps
    /// BEFORE any frame is grabbed, so their content never reaches the log.
    static func isDenyListed(_ app: String) -> Bool {
        let lower = app.lowercased()
        return denyList.contains { lower.contains($0.lowercased()) }
    }
}
