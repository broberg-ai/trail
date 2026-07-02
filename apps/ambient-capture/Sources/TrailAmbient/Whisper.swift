// F201.6.2 — on-device Whisper STT via WhisperKit (CoreML / Neural Engine).
//
// $0, no cloud, no key: the model runs entirely on-device, so audio never
// leaves the machine — only the transcript text does (the egress guarantee,
// same as screen frames). Model "large-v3" was chosen (Christian, 2026-07-03:
// "small" transcribed Danish poorly) — model size is the dominant lever for
// Danish accuracy, and it decides whether a transcript becomes a usable Neuron
// or garbage. WhisperKit ships a COMPRESSED CoreML build (~1 GB, not the ~3 GB
// PyTorch weights), loaded once (downloaded to Application Support on first use)
// then cached + kept resident.
import Foundation
import CoreML
import WhisperKit

actor Whisper {
    static let shared = Whisper()

    /// "large-v3" — Whisper's best Danish, on-device (~1 GB CoreML). We TRIED
    /// large-v3-turbo for speed (2026-07-03), but its ANE compilation was
    /// pathological on this Mac: 6+ min at 99% ANECompilerService (~30× worse
    /// than large-v3), likely its extra TextDecoderContextPrefill stage. large-v3
    /// compiles fine + is already cached + gives the best Danish, and the
    /// whole-buffer transcribe (one pass, not per-segment) is what actually cut
    /// the latency — so we ship large-v3, not turbo.
    static let modelName = "large-v3"

    private var pipe: WhisperKit?

    /// Kick off the (one-time) ~1 GB model download + load in the BACKGROUND at
    /// launch, so the first capture doesn't hang for minutes while it downloads.
    /// Errors are swallowed — a capture arriving before it's ready just awaits the
    /// same ensurePipe().
    func prewarm() async { _ = try? await ensurePipe() }

    /// Transcribe already-decoded 16 kHz mono samples (the live-capture path feeds
    /// VAD segments straight in — no round-trip through a file).
    func transcribe(samples: [Float], language: String = "da") async throws -> String {
        let pipe = try await ensurePipe()
        let options = DecodingOptions(task: .transcribe, language: language)
        let results: [TranscriptionResult] = try await pipe.transcribe(audioArray: samples, decodeOptions: options)
        return results.map { $0.text }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Transcribe an audio file (the `--sttest` proof path).
    func transcribe(path: String, language: String = "da") async throws -> String {
        guard let samples = AudioWatcher.decodeToMono16k(path: path) else {
            throw NSError(domain: "Whisper", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "could not decode \(path)"])
        }
        return try await transcribe(samples: samples, language: language)
    }

    /// Load (and on first run download) the model once; reuse thereafter.
    private func ensurePipe() async throws -> WhisperKit {
        if let pipe { return pipe }
        // Run on CPU+GPU (Metal), NOT the Neural Engine. WhisperKit's default
        // textDecoderCompute is .cpuAndNeuralEngine, which triggers a pathological
        // one-time ANE COMPILATION (ANECompilerService pegged at 99% for 6+ min on
        // large models — Christian 2026-07-03, ~30× the whole capture). The Metal
        // GPU path compiles in seconds, so the very first capture is usable — we
        // trade a little steady-state speed for no multi-minute launch hang.
        let config = WhisperKitConfig(
            model: Self.modelName,
            computeOptions: ModelComputeOptions(
                audioEncoderCompute: .cpuAndGPU,
                textDecoderCompute: .cpuAndGPU
            )
        )
        let p = try await WhisperKit(config)
        pipe = p
        Task { @MainActor in EventLog.shared.log(kind: "whisper_model_ready") }
        return p
    }
}
