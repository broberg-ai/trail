// F201.3 — menubar status item + app lifecycle.
//
// The status item is the product's transparency contract: it always shows
// whether the agent is capturing (●) or paused (॥), which Trail account the
// device is connected to, and is the entry point for settings. LSUIElement/
// .accessory means this is the ONLY visible surface.
import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let focusWatcher = FocusWatcher()
    private let deviceAuth = DeviceAuth()

    private var paused = false {
        didSet { render() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        render()
        // TCC: prompt for Accessibility on first run — required for window
        // titles via AXUIElement. The system remembers the answer.
        FocusWatcher.promptForAccessibilityIfNeeded()
        focusWatcher.start()
    }

    private func render() {
        // Trail mark instead of a text glyph — accent core FILLED while
        // capturing, OUTLINE while paused (the visible recording tell).
        statusItem.button?.image = TrailMark.menubarImage(filled: !paused)
        statusItem.button?.title = ""
        statusItem.button?.toolTip = paused
            ? "Trail Ambient — på pause (ingen capture)"
            : "Trail Ambient — capturer aktivt"
        statusItem.menu = buildMenu()
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
                // Async gravatar — refreshes the menu when it lands.
                Gravatar.avatar(for: email) { [weak self] img in
                    header.image = img
                    self?.render()
                }
            }
            menu.addItem(header)
            if let kb = deviceAuth.kbLabel {
                let kbItem = NSMenuItem(title: "Skriver til: \(kb)", action: nil, keyEquivalent: "")
                kbItem.isEnabled = false
                menu.addItem(kbItem)
            }
            menu.addItem(.separator())
        }

        let state = NSMenuItem(
            title: paused ? "På pause — ingen capture" : "Capturer aktivt",
            action: nil, keyEquivalent: ""
        )
        state.isEnabled = false
        menu.addItem(state)

        if !deviceAuth.isConnected {
            let statusText: String
            switch deviceAuth.state {
            case .waiting: statusText = "Venter på godkendelse i browseren…"
            default: statusText = "Ikke forbundet til Trail"
            }
            let account = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
            account.isEnabled = false
            menu.addItem(account)
        }
        menu.addItem(.separator())

        let pause = NSMenuItem(
            title: paused ? "Genoptag capture" : "Pause capture",
            action: #selector(togglePause), keyEquivalent: "p"
        )
        pause.target = self
        menu.addItem(pause)

        if !deviceAuth.isConnected {
            let connect = NSMenuItem(
                title: deviceAuth.state == .waiting ? "Åbn godkendelses-siden igen" : "Forbind til Trail…",
                action: #selector(connectToTrail), keyEquivalent: ""
            )
            connect.target = self
            menu.addItem(connect)
        }

        // Settings — deny-list is enforced by the gate from F201.4; the
        // submenu makes today's defaults visible where users expect them.
        let settingsMenu = NSMenu()
        let denyHeader = NSMenuItem(title: "Capturer aldrig fra:", action: nil, keyEquivalent: "")
        denyHeader.isEnabled = false
        settingsMenu.addItem(denyHeader)
        for app in Settings.denyList {
            let item = NSMenuItem(title: "  \(app)", action: nil, keyEquivalent: "")
            item.isEnabled = false
            settingsMenu.addItem(item)
        }
        if deviceAuth.isConnected {
            settingsMenu.addItem(.separator())
            let disconnect = NSMenuItem(
                title: "Frakobl fra Trail",
                action: #selector(disconnectFromTrail), keyEquivalent: ""
            )
            disconnect.target = self
            settingsMenu.addItem(disconnect)
        }
        let settings = NSMenuItem(title: "Indstillinger", action: nil, keyEquivalent: "")
        menu.addItem(settings)
        menu.setSubmenu(settingsMenu, for: settings)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Afslut Trail Ambient", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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

    @objc private func togglePause() {
        paused.toggle()
        focusWatcher.paused = paused
        EventLog.shared.log(kind: paused ? "capture_paused" : "capture_resumed")
    }

    @objc private func connectToTrail() {
        deviceAuth.beginConnect { [weak self] in
            self?.render()
        }
    }

    @objc private func disconnectFromTrail() {
        deviceAuth.disconnect()
        render()
    }
}

enum Settings {
    /// Default per-app deny-list (F201 privacy rule). Enforcement happens in
    /// the gate (F201.4); user-editable list is F201.4+ scope.
    static let denyList = ["1Password", "Banking", "Messages", "Signal"]
}
