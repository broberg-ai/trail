// F201.6.6 — on-device speaker voice-print (Approach A: open-set embedding +
// cosine gate). Pure DSP over Accelerate: maps a 16 kHz mono float utterance to
// a compact speaker embedding (MFCC statistics — mean+std of the cepstrum over
// voiced frames), so ambient capture can gate on "is this the owner speaking?"
// via cosine similarity. No model file, no audio egress; the embedding is a
// derived, non-invertible feature vector. Deterministically testable headlessly
// — the same pure-core convention as VAD (F201.6.1) and Vision OCR (F201.5).
//
// Open-set by construction: ANY voice gets an embedding and is compared to the
// owner centroid, so a never-heard voice (TV, a colleague) is rejected on
// distance — not on having been trained as a negative. A neural CoreML speaker
// model is the evidence-gated upgrade if this proves insufficient in real use
// (see the F201.6.6 plan-doc — LoRA/heavy models are deferred, decided on data).
import Foundation
import Accelerate

enum SpeakerEmbedding {
    static let sampleRate = 16_000
    static let frameSize = 400      // 25 ms @ 16 kHz
    static let hopSize = 160        // 10 ms @ 16 kHz
    static let fftSize = 512        // next pow2 ≥ frameSize
    static let melBands = 26
    static let numCeps = 13         // MFCCs kept (c1…c13; c0 = energy, dropped)

    /// Embedding dimension = mean + std of the kept cepstral coefficients.
    static var dimension: Int { numCeps * 2 }

    /// Compute a speaker embedding for a mono 16 kHz utterance, or nil when there
    /// isn't enough voiced audio to characterise the speaker. Only VAD-voiced
    /// frames feed the statistics, so silence/room-tone never dilutes the print.
    static func embed(_ samples: [Float], minVoicedFrames: Int = 8) -> [Float]? {
        let voiced = voicedSamples(samples)
        let frames = mfccFrames(voiced)
        guard frames.count >= minVoicedFrames else { return nil }

        var mean = [Float](repeating: 0, count: numCeps)
        for f in frames { for j in 0..<numCeps { mean[j] += f[j] } }
        for j in 0..<numCeps { mean[j] /= Float(frames.count) }

        var std = [Float](repeating: 0, count: numCeps)
        for f in frames { for j in 0..<numCeps { let d = f[j] - mean[j]; std[j] += d * d } }
        for j in 0..<numCeps { std[j] = (std[j] / Float(frames.count)).squareRoot() }

        var emb = mean + std
        l2normalize(&emb)
        return emb
    }

    /// Cosine similarity of two L2-normalised embeddings (= dot product). Range
    /// roughly [-1, 1]; higher = same speaker.
    static func cosine(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        var dot: Float = 0
        vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
        return dot
    }

    // MARK: - internals

    /// Concatenate only the VAD-voiced spans; fall back to the whole clip when
    /// VAD finds nothing (short/quiet utterance) so we still try to embed it.
    private static func voicedSamples(_ samples: [Float]) -> [Float] {
        let segs = VAD().segments(samples)
        guard !segs.isEmpty else { return samples }
        var v: [Float] = []
        for s in segs {
            let lo = max(0, s.startSample), hi = min(s.endSample, samples.count)
            if hi > lo { v.append(contentsOf: samples[lo..<hi]) }
        }
        return v
    }

    private static func l2normalize(_ v: inout [Float]) {
        var sq: Float = 0
        vDSP_svesq(v, 1, &sq, vDSP_Length(v.count))
        let norm = sq.squareRoot()
        if norm > 1e-9 { var inv = 1 / norm; vDSP_vsmul(v, 1, &inv, &v, 1, vDSP_Length(v.count)) }
    }

    private static let hamming: [Float] = (0..<frameSize).map {
        0.54 - 0.46 * cos(2 * Float.pi * Float($0) / Float(frameSize - 1))
    }
    private static let melFilters: [[Float]] = buildMelFilters()          // [melBands][fftSize/2]
    private static let dft = try! vDSP.DiscreteFourierTransform(
        count: fftSize, direction: .forward,
        transformType: .complexComplex, ofType: Float.self)

    /// Per-frame MFCC vectors (numCeps each) over the (voiced) signal. NB: no
    /// cepstral-mean normalisation — capture is same-mic, so the long-term
    /// cepstral mean IS speaker-discriminative and we want to keep it.
    private static func mfccFrames(_ samples: [Float]) -> [[Float]] {
        guard samples.count >= frameSize else { return [] }

        // Pre-emphasis (flatten spectral tilt, boost formant detail).
        var pre = [Float](repeating: 0, count: samples.count)
        pre[0] = samples[0]
        for i in 1..<samples.count { pre[i] = samples[i] - 0.97 * samples[i - 1] }

        let half = fftSize / 2
        let imagIn = [Float](repeating: 0, count: fftSize)
        var real = [Float](repeating: 0, count: fftSize)
        var out: [[Float]] = []

        var start = 0
        while start + frameSize <= pre.count {
            for i in 0..<frameSize { real[i] = pre[start + i] * hamming[i] }
            for i in frameSize..<fftSize { real[i] = 0 }

            let spec = dft.transform(real: real, imaginary: imagIn)
            var power = [Float](repeating: 0, count: half)
            for k in 0..<half { power[k] = spec.real[k] * spec.real[k] + spec.imaginary[k] * spec.imaginary[k] }

            var logmel = [Float](repeating: 0, count: melBands)
            for m in 0..<melBands {
                let filt = melFilters[m]
                var e: Float = 0
                for k in 0..<half { e += filt[k] * power[k] }
                logmel[m] = log(max(e, 1e-10))
            }

            // DCT-II of the log-mel energies → keep c1…cNumCeps (drop c0/energy).
            var ceps = [Float](repeating: 0, count: numCeps)
            for j in 0..<numCeps {
                let jj = Float(j + 1)
                var s: Float = 0
                for m in 0..<melBands { s += logmel[m] * cos(Float.pi * jj * (Float(m) + 0.5) / Float(melBands)) }
                ceps[j] = s
            }
            out.append(ceps)
            start += hopSize
        }
        return out
    }

    private static func buildMelFilters() -> [[Float]] {
        let half = fftSize / 2
        let sr = Float(sampleRate)
        func hz2mel(_ f: Float) -> Float { 2595 * log10(1 + f / 700) }
        func mel2hz(_ m: Float) -> Float { 700 * (pow(10, m / 2595) - 1) }

        let lowMel = hz2mel(0), highMel = hz2mel(sr / 2)
        let hzPoints = (0..<(melBands + 2)).map {
            mel2hz(lowMel + (highMel - lowMel) * Float($0) / Float(melBands + 1))
        }
        let bins = hzPoints.map { Int(floor(($0 / (sr / 2)) * Float(half - 1))) }

        var filters = [[Float]](repeating: [Float](repeating: 0, count: half), count: melBands)
        for m in 1...melBands {
            let l = bins[m - 1], c = bins[m], r = bins[m + 1]
            if c <= l || r <= c { continue }   // degenerate (equal bins at low freq) → empty filter
            for k in l..<c where k >= 0 && k < half { filters[m - 1][k] = Float(k - l) / Float(c - l) }
            for k in c..<r where k >= 0 && k < half { filters[m - 1][k] = Float(r - k) / Float(r - c) }
        }
        return filters
    }
}
