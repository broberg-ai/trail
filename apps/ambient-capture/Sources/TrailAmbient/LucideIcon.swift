// F201.15 — Lucide icons embedded as SVG, rendered via NSImage's SVG support
// (macOS 13+, verified rendering on the target OS). Kept as template images so
// SwiftUI `.foregroundColor` tints them, matching the design system exactly
// instead of an approximate SF Symbol (Christian 2026-07-03: "brug lucide Speech
// i footer"). Lucide is ISC-licensed.
import AppKit
import SwiftUI

enum LucideIcon {
    /// lucide.dev "speech" — the Prompt-Mode target marker (dictation → session).
    private static let speechSVG = """
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20"/><path d="M19.8 17.8a7.5 7.5 0 0 0 .003-10.603"/><path d="M17 15a3.5 3.5 0 0 0-.025-4.975"/></svg>
    """

    static let speech: NSImage? = image(from: speechSVG)

    private static func image(from svg: String) -> NSImage? {
        guard let data = svg.data(using: .utf8), let img = NSImage(data: data) else { return nil }
        img.isTemplate = true   // alpha mask → tintable by SwiftUI .foregroundColor
        return img
    }
}

/// SwiftUI wrapper — renders the Lucide "speech" glyph tinted, or falls back to
/// an SF Symbol if this OS can't decode the SVG.
struct LucideSpeech: View {
    var size: CGFloat
    var color: Color
    var body: some View {
        Group {
            if let img = LucideIcon.speech {
                Image(nsImage: img).renderingMode(.template).resizable().scaledToFit()
            } else {
                Image(systemName: "text.bubble.fill").resizable().scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .foregroundColor(color)
    }
}
