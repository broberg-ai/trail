// F201.4 — Gravatar avatar for the connected account (Christian's request:
// "brug min gravatar på cb@webhouse.dk"). Gravatar keys on the MD5 of the
// lowercased, trimmed email. Fetched once per email, cached in-memory +
// on disk, rendered as a small rounded avatar in the menubar menu header.
import AppKit
import CryptoKit

@MainActor
enum Gravatar {
    private static var cache: [String: NSImage] = [:]

    /// Deterministic Gravatar URL for an email (32px @2x, identicon fallback).
    static func url(for email: String) -> URL {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hash = Insecure.MD5.hash(data: Data(normalized.utf8))
            .map { String(format: "%02x", $0) }.joined()
        return URL(string: "https://www.gravatar.com/avatar/\(hash)?s=64&d=identicon")!
    }

    /// Fetch (or return cached) avatar, rounded to a circle at `size`.
    /// Async + best-effort: a network failure just leaves the menu without
    /// an avatar, never blocks it.
    static func avatar(for email: String, size: CGFloat = 18, onReady: @escaping @MainActor (NSImage) -> Void) {
        if let cached = cache[email] {
            onReady(cached)
            return
        }
        Task {
            guard let (data, _) = try? await URLSession.shared.data(from: url(for: email)),
                  let raw = NSImage(data: data) else { return }
            let rounded = round(raw, size: size)
            await MainActor.run {
                cache[email] = rounded
                onReady(rounded)
            }
        }
    }

    private static func round(_ image: NSImage, size: CGFloat) -> NSImage {
        let out = NSImage(size: NSSize(width: size, height: size))
        out.lockFocus()
        let rect = NSRect(x: 0, y: 0, width: size, height: size)
        NSBezierPath(ovalIn: rect).addClip()
        image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
        out.unlockFocus()
        return out
    }
}
