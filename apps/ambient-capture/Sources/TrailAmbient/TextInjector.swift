// F201.15 — inject dictated text into whatever field currently has focus, in ANY
// app (Chrome's Agents chat, iTerm, Slack, a doc). This is the universal Prompt-
// Mode delivery (Christian 2026-07-03: "lade dig sprøjte tekst afsted i det felt
// jeg står i") — no session resolution, no URL mapping, no cloud round-trip.
//
// Mechanism: put the text on the pasteboard and synthesize ⌘V, optionally
// followed by Return. Paste (not per-character key events) is used because it is
// reliable across native text fields AND web contenteditable/inputs, and is
// instant for long dictations. The prior clipboard is restored afterward.
//
// PERMISSION: synthesizing input events requires Accessibility (already granted
// for AXUIElement window-title reads) — NOT Automation/Apple Events.
import AppKit
import Carbon.HIToolbox

enum TextInjector {
    /// Paste `text` into the frontmost app's focused field, optionally pressing
    /// Return after. Assumes the intended target app is already frontmost (the
    /// caller re-activates it + waits before calling this).
    static func inject(_ text: String, pressEnter: Bool) {
        let pb = NSPasteboard.general
        let saved = pb.string(forType: .string)
        pb.clearContents()
        pb.setString(text, forType: .string)

        let src = CGEventSource(stateID: .combinedSessionState)
        keyStroke(src, key: CGKeyCode(kVK_ANSI_V), flags: .maskCommand)   // ⌘V
        if pressEnter {
            keyStroke(src, key: CGKeyCode(kVK_Return), flags: [])
        }

        // Restore the user's clipboard once the paste has landed.
        if let saved {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                pb.clearContents()
                pb.setString(saved, forType: .string)
            }
        }
    }

    private static func keyStroke(_ src: CGEventSource?, key: CGKeyCode, flags: CGEventFlags) {
        guard let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true),
              let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false) else { return }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}
