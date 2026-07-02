// F201.6.1 — energy/RMS voice-activity detection over 16 kHz mono PCM.
//
// Pure DSP: no capture, no I/O, no async. AudioWatcher feeds it live mic frames;
// the `--audiotest` self-test feeds it a decoded WAV or a synthesised buffer.
// Keeping it a pure function over `[Float]` is what makes the segmentation logic
// — the risky part — deterministically testable headlessly (AC1), the same way
// F201.5 split Vision OCR (needs a grant) from the delta hash (pure).
//
// Algorithm: frame the signal (20 ms frames), mark each frame voiced when its
// RMS clears `threshold`, and coalesce voiced frames into segments. A run of
// silence longer than `hangoverMs` closes a segment (so natural pauses inside a
// sentence don't fragment it); a segment shorter than `minSpeechMs` is dropped
// as a click/pop rather than emitted as speech.
import Foundation

struct VAD {
    /// RMS above which a frame counts as speech, in normalised float PCM (−1…1).
    var threshold: Float = 0.012
    /// Minimum voiced duration for a segment to be emitted (shorter → dropped).
    var minSpeechMs: Int = 250
    /// Trailing silence tolerated inside a segment before it closes.
    var hangoverMs: Int = 400
    /// Frame size in samples (20 ms at 16 kHz = 320).
    var frameSamples: Int = 320
    /// Sample rate the buffer is assumed to be at (AudioWatcher resamples to this).
    var sampleRate: Int = 16_000

    struct Segment: Equatable {
        let startSample: Int
        let endSample: Int
        let sampleRate: Int
        var startSeconds: Double { Double(startSample) / Double(sampleRate) }
        var endSeconds: Double { Double(endSample) / Double(sampleRate) }
        var durationSeconds: Double { endSeconds - startSeconds }
    }

    /// Split a mono float buffer into speech segments (in input-sample terms).
    func segments(_ samples: [Float]) -> [Segment] {
        guard frameSamples > 0, !samples.isEmpty else { return [] }
        let minSpeechFrames = max(1, (minSpeechMs * sampleRate / 1000) / frameSamples)
        let hangoverFrames = max(0, (hangoverMs * sampleRate / 1000) / frameSamples)

        var out: [Segment] = []
        var inSpeech = false
        var segStart = 0
        var lastVoicedEnd = 0
        var voicedFrames = 0
        var silenceRun = 0

        var i = 0
        while i < samples.count {
            let end = min(i + frameSamples, samples.count)
            let voiced = Self.rms(samples[i..<end]) >= threshold
            if voiced {
                if !inSpeech { inSpeech = true; segStart = i; voicedFrames = 0 }
                voicedFrames += 1
                lastVoicedEnd = end
                silenceRun = 0
            } else if inSpeech {
                silenceRun += 1
                if silenceRun > hangoverFrames {
                    if voicedFrames >= minSpeechFrames {
                        out.append(Segment(startSample: segStart, endSample: lastVoicedEnd, sampleRate: sampleRate))
                    }
                    inSpeech = false
                }
            }
            i = end
        }
        // Close a segment still open at end-of-buffer.
        if inSpeech && voicedFrames >= minSpeechFrames {
            out.append(Segment(startSample: segStart, endSample: lastVoicedEnd, sampleRate: sampleRate))
        }
        return out
    }

    /// Root-mean-square energy of one frame.
    static func rms(_ frame: ArraySlice<Float>) -> Float {
        guard !frame.isEmpty else { return 0 }
        var sum: Float = 0
        for s in frame { sum += s * s }
        return (sum / Float(frame.count)).squareRoot()
    }
}
