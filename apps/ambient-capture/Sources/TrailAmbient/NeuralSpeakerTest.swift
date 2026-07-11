// F201.6.6 — `TrailAmbient --neuraltest <wav>...`. Decisive measurement of the
// NEURAL embedder (FluidAudio) on real clips: does it fix the channel problem
// the classical embedder had (same speaker across sessions = 0.535)? Prints the
// pairwise cosine similarity of every clip pair so we can read owner-consistency
// (same speaker, high) and, given a non-owner clip, discrimination (low).
import Foundation

enum NeuralSpeakerTest {
    static func run() -> Never {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--neuraltest") else { exit(2) }
        let paths = Array(args[(i + 1)...]).filter { !$0.hasPrefix("--") }
        guard !paths.isEmpty else {
            print("usage: --neuraltest <wav|m4a>...  (first run downloads ~100MB models)")
            exit(2)
        }
        let sem = DispatchSemaphore(value: 0)
        Task {
            await measure(paths)
            sem.signal()
        }
        sem.wait()
        exit(0)
    }

    private static func measure(_ paths: [String]) async {
        print("loading FluidAudio models (first run downloads ~100MB)…")
        var embs: [(name: String, emb: [Float])] = []
        for p in paths {
            guard let buf = AudioWatcher.decodeToMono16k(path: p) else {
                print("  ✗ could not decode \(p)"); continue
            }
            guard let e = await NeuralSpeaker.shared.embed(buf) else {
                print("  ✗ could not embed \(p) (models unavailable or too short)"); continue
            }
            let name = (p as NSString).lastPathComponent
            embs.append((name, e))
            print("  ✓ embedded \(name)  (\(String(format: "%.1f", Double(buf.count) / 16_000))s → \(e.count)-d)")
        }
        guard embs.count >= 2 else { print("need ≥2 embeddable clips"); return }
        print("\npairwise cosine similarity (higher = same speaker):")
        for a in 0..<embs.count {
            for b in (a + 1)..<embs.count {
                let s = NeuralSpeaker.similarity(embs[a].emb, embs[b].emb)
                print(String(format: "  %.3f   %@  ↔  %@", s, embs[a].name, embs[b].name))
            }
        }
    }
}
