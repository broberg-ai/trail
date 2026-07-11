// F201.6.6 — voice-enrollment coordinator. Records the owner speaking via the
// existing mic tap, splits the take into a few chunks (a steadier centroid than
// one long window), and builds the on-device voice-print (SpeakerGate.enroll).
// No audio ever leaves the machine — only the derived print is stored locally.
//
// Menubar-driven (AppDelegate): click "Enroll my voice" → speak → click "Finish"
// → the print is built + persisted. `onChange` re-renders the menu on each state
// change so the item text and result line stay honest.
import Foundation

@MainActor
final class SpeakerEnroll {
    static let shared = SpeakerEnroll()

    private(set) var recording = false
    /// Human-readable outcome of the last enrolment attempt (shown in the menu).
    private(set) var lastResult: String?
    /// Re-render hook the menubar sets, called on every state change.
    var onChange: (() -> Void)?

    var isEnrolled: Bool { SpeakerGate.isEnrolled }

    /// Begin recording, or finish the take and build the print.
    func toggle() { recording ? finish() : begin() }

    private func begin() {
        AudioWatcher.requestMicIfNeeded()
        guard AudioWatcher.isMicGranted else {
            lastResult = S.enrollNeedsMic; onChange?(); return
        }
        lastResult = nil
        Task {
            let ok = await AudioWatcher.shared.record()
            self.recording = ok
            if !ok { self.lastResult = S.enrollFailed }
            self.onChange?()
        }
    }

    private func finish() {
        recording = false
        lastResult = S.enrollBuilding      // model download/inference can take a moment
        onChange?()
        Task {
            let samples = await AudioWatcher.shared.finishAndReturnSamples()
            let secs = Double(samples.count) / 16_000.0
            if let _ = await SpeakerGate.enroll(samples) {
                self.lastResult = String(format: S.enrollDoneFmt, secs)
                EventLog.shared.log(kind: "speaker_enrolled secs=\(String(format: "%.1f", secs))")
            } else {
                self.lastResult = S.enrollTooShort
                EventLog.shared.log(kind: "speaker_enroll_failed no_embed")
            }
            self.onChange?()
        }
    }

    /// Forget the enrolled voice (privacy reset / re-enroll from scratch).
    func clear() {
        SpeakerGate.clear()
        lastResult = nil
        EventLog.shared.log(kind: "speaker_print_cleared")
        onChange?()
    }

}
