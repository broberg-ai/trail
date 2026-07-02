// F201.5 — screen-frame capture + on-device Vision OCR.
//
// On focus-settle the agent grabs ONE frame of the frontmost window
// (ScreenCaptureKit's SCScreenshotManager — a single shot, not a running
// stream, so a static desktop costs nothing), hashes it against the last frame
// for that app (the delta guard — an unchanged window does NO repeated OCR
// work), and runs Vision's on-device text recognizer. Only the recognized
// TEXT is ever returned; the frame lives solely as pixels in memory for the
// ~50 ms the OCR takes and is never persisted, never network-sent. That is the
// egress guarantee (F201.5 AC): frames cannot leave the machine because no
// code here ever hands a frame to anything but Vision.
//
// Deny-listed apps are never captured — OCR text of a 1Password/banking window
// must not even reach the local log. Screen Recording is a separate TCC grant
// (CGRequestScreenCaptureAccess); without it capture ships dark (logs
// screen_capture_untrusted, returns nil) exactly like Accessibility for titles.
import AppKit
import ScreenCaptureKit
import Vision
import CryptoKit

actor ScreenWatcher {
    static let shared = ScreenWatcher()

    /// Cap OCR output so a dense screen can't bloat a candidate.
    private let maxChars = 4000
    /// Last frame hash per owning-pid — the delta guard's memory.
    private var lastHash: [pid_t: String] = [:]

    /// Prompt for Screen Recording on first run (system remembers the answer).
    /// A granted Screen Recording permission needs an app relaunch to take.
    nonisolated static func requestScreenRecordingIfNeeded() {
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
    }

    nonisolated static var isScreenRecordingGranted: Bool { CGPreflightScreenCaptureAccess() }

    /// Capture + OCR the frontmost window of `app`/`pid`. Returns recognized
    /// text, or nil when: deny-listed, no Screen Recording grant, no capturable
    /// window, or the frame is unchanged since last capture (a static-skip).
    func capture(app: String, pid: pid_t) async -> String? {
        // Privacy guard FIRST — never grab a frame of a deny-listed app.
        if Settings.isDenyListed(app) { return nil }

        guard CGPreflightScreenCaptureAccess() else {
            await logKind("screen_capture_untrusted")
            return nil
        }
        guard let window = await frontWindow(pid: pid),
              let image = await Self.screenshot(of: window) else { return nil }

        // Delta guard: identical content to last capture for this app → skip
        // OCR entirely (AC: a static window does no repeated OCR work).
        let hash = Self.hash(image)
        if lastHash[pid] == hash {
            await logKind("screen_static_skipped")
            return nil
        }
        lastHash[pid] = hash

        let text = await Self.recognizeText(in: image, maxChars: maxChars)
        return text.isEmpty ? nil : text
    }

    // MARK: Window selection

    /// The frontmost on-screen normal-layer window owned by `pid`, largest by
    /// area (the main document window rather than a tooltip/panel).
    private func frontWindow(pid: pid_t) async -> SCWindow? {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else {
            await logKind("screen_capture_untrusted")
            return nil
        }
        let mine = content.windows.filter {
            $0.owningApplication?.processID == pid && $0.isOnScreen && $0.windowLayer == 0
                && $0.frame.width > 100 && $0.frame.height > 100
        }
        return mine.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    }

    private static func screenshot(of window: SCWindow) async -> CGImage? {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = min(Int(window.frame.width * 2), 4000)   // 2× for OCR legibility
        config.height = min(Int(window.frame.height * 2), 4000)
        config.showsCursor = false
        return try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    // MARK: OCR + delta hash (static, nonisolated → run off the actor's thread)

    /// On-device text recognition. `.accurate`, da+en, no network — Vision runs
    /// entirely on the Neural Engine / CPU.
    static func recognizeText(in image: CGImage, maxChars: Int) async -> String {
        await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
            let request = VNRecognizeTextRequest { req, _ in
                let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
                var text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                if text.count > maxChars { text = String(text.prefix(maxChars)) }
                cont.resume(returning: text)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["da-DK", "en-US"]
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do { try handler.perform([request]) } catch { cont.resume(returning: "") }
        }
    }

    /// Cheap perceptual hash: downscale to 32×32 grayscale and SHA256 the
    /// bytes. Minor sub-pixel noise collapses; a real content change flips it.
    static func hash(_ image: CGImage) -> String {
        let w = 32, h = 32
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return UUID().uuidString }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return UUID().uuidString }
        let bytes = Data(bytes: data, count: w * h)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private func logKind(_ kind: String) async {
        await MainActor.run { EventLog.shared.log(kind: kind) }
    }
}
