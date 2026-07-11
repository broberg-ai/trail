// F201.6.6 — on-device NEURAL speaker embedding via FluidAudio (WeSpeaker
// 256-d, CoreML/ANE). Replaces the classical MFCC-stats embedding, which was
// channel-dominated: the same speaker across two recordings scored only 0.535
// (worse than two different synthetic voices). A trained embedding is channel-
// robust AND speaker-discriminative — the whole point of Approach A.
//
// Models (~100 MB: pyannote segmentation + WeSpeaker) download ONCE from
// HuggingFace on first use and cache under Application Support/FluidAudio — the
// model, never user audio; capture's no-egress guarantee is unaffected.
import Foundation
import Accelerate
import FluidAudio

actor NeuralSpeaker {
    static let shared = NeuralSpeaker()

    static let embeddingSize = SpeakerManager.embeddingSize   // 256
    /// ~10 s windows match the segmentation model the embedder masks against.
    private static let windowSamples = 10 * 16_000
    private static let minSamples = 16_000                    // <1 s → skip

    private var diarizer: DiarizerManager?
    private var loadFailed = false

    /// Lazy-load the models on first call; nil if unavailable (e.g. offline
    /// first-run). Cached for the process lifetime after a successful load.
    private func manager() async -> DiarizerManager? {
        if let diarizer { return diarizer }
        if loadFailed { return nil }
        do {
            let models = try await DiarizerModels.download()
            let d = DiarizerManager()
            d.initialize(models: models)
            diarizer = d
            return d
        } catch {
            loadFailed = true
            return nil
        }
    }

    var isReady: Bool { diarizer != nil }

    /// A 256-d L2-normalised speaker embedding for a 16 kHz mono utterance, or
    /// nil if the models aren't available or there's too little audio. Averages
    /// per-window embeddings over ~10 s windows for a steadier centroid.
    func embed(_ samples: [Float]) async -> [Float]? {
        guard samples.count >= Self.minSamples, let d = await manager() else { return nil }
        var acc = [Float](repeating: 0, count: Self.embeddingSize)
        var n = 0
        for w in Self.windows(samples) {
            guard let e = try? d.extractSpeakerEmbedding(from: w), e.count == Self.embeddingSize else { continue }
            for i in 0..<acc.count { acc[i] += e[i] }
            n += 1
        }
        guard n > 0 else { return nil }
        var norm: Float = 0
        for v in acc { norm += v * v }
        norm = norm.squareRoot()
        if norm > 1e-9 { for i in 0..<acc.count { acc[i] /= norm } }
        return acc
    }

    /// Cosine similarity — higher = same speaker. Embeddings are L2-normalised,
    /// so the dot product IS the cosine.
    nonisolated static func similarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        var dot: Float = 0
        vDSP_dotpr(a, 1, b, 1, &dot, vDSP_Length(a.count))
        return dot
    }

    private static func windows(_ samples: [Float]) -> [[Float]] {
        guard samples.count > windowSamples else { return [samples] }
        var out: [[Float]] = []
        var i = 0
        while i < samples.count {
            let end = min(i + windowSamples, samples.count)
            if end - i >= minSamples { out.append(Array(samples[i..<end])) }
            i += windowSamples
        }
        return out.isEmpty ? [samples] : out
    }
}
