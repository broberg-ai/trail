// F201.6.2 — on-device Whisper STT via WhisperKit (CoreML / Neural Engine).
//
// $0, no cloud, no key: the model runs entirely on-device, so audio never
// leaves the machine — only the transcript text does (the egress guarantee,
// same as screen frames). Model "small" was chosen over "base" for markedly
// better Danish (Christian's primary language), which is what decides whether a
// transcript becomes a usable Neuron or garbage; over Apple's SFSpeechRecognizer
// for the same reason. The model is loaded once (downloaded to Application
// Support on first use) and reused.
import Foundation
import WhisperKit

actor Whisper {
    static let shared = Whisper()

    /// "small" — better Danish than "base", still fast on M1. One knob for quality.
    static let modelName = "small"

    private var pipe: WhisperKit?

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
        let p = try await WhisperKit(WhisperKitConfig(model: Self.modelName))
        pipe = p
        return p
    }
}
