// F201.6.6 verification — `TrailAmbient --speakertest [ownerWav… -- otherWav…]`.
// Proves the pure speaker-gate core headlessly (no mic, no model file), the same
// deterministic-core split as --audiotest (VAD) and --ocrtest (Vision):
//   • the embedding is deterministic + correctly dimensioned,
//   • it SEPARATES two distinct synthetic voices (same-voice cosine > cross-voice),
//   • enroll → persist → load round-trips, and the gate accepts the enrolled
//     voice while rejecting the other,
//   • the gate FAILS OPEN when no print is enrolled (ship-dark).
// Optional real-WAV mode enrolls on owner clips and scores an "other" clip so the
// real corpus can be spot-checked; the whole-voice DSP is proven deterministically.
import Foundation

enum SpeakerTest {
    static func run() -> Never {
        var pass = 0, fail = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            print("\(ok ? "✓" : "✗") \(name)\(detail.isEmpty ? "" : "  — \(detail)")")
            ok ? (pass += 1) : (fail += 1)
        }

        // Two distinct synthetic "voices": a glottal-ish harmonic source (F0)
        // shaped by different formant envelopes → different spectral shape →
        // different MFCC statistics. Not real speech, but enough to prove the
        // embedding separates speakers deterministically.
        let a = voiceLike(f0: 120, formants: [500, 1500, 2500], seconds: 3.0)
        let b = voiceLike(f0: 210, formants: [320, 900, 2200], seconds: 3.0)

        check("embedding dimension = \(SpeakerEmbedding.dimension)",
              SpeakerEmbedding.embed(a)?.count == SpeakerEmbedding.dimension)

        guard let embA = SpeakerEmbedding.embed(a), let embB = SpeakerEmbedding.embed(b) else {
            check("embed voice A and B", false, "one returned nil")
            print("\nSPEAKERTEST: \(pass)/\(pass + fail) checks passed"); exit(1)
        }

        // Determinism — same samples → identical embedding.
        check("embedding is deterministic", SpeakerEmbedding.embed(a) == embA)

        // Separation — the two halves of ONE voice are more alike than the two
        // voices are to each other, by a clear margin.
        let aFirst = Array(a[0..<(a.count / 2)]), aSecond = Array(a[(a.count / 2)...])
        guard let e1 = SpeakerEmbedding.embed(aFirst), let e2 = SpeakerEmbedding.embed(aSecond) else {
            check("embed A halves", false); print("\nSPEAKERTEST: \(pass)/\(pass + fail) checks passed"); exit(1)
        }
        let selfSim = SpeakerEmbedding.cosine(e1, e2)
        let crossSim = SpeakerEmbedding.cosine(e1, embB)
        check("same-voice cosine > cross-voice cosine",
              selfSim > crossSim + 0.02, "self=\(f(selfSim)) cross=\(f(crossSim))")

        // Gate mechanism — enroll on the owner, verify accept-owner / reject-other.
        // Uses a threshold at the midpoint of the two similarities so the test
        // proves the GATE plumbing given separable inputs, independent of the
        // production default (which is tuned on the real corpus, per the plan).
        withBackedUpPrint {
            SpeakerGate.clear()
            check("gate fails OPEN when not enrolled", SpeakerGate.isOwner(b).owner)

            let ownerSim = SpeakerEmbedding.cosine(embA, enrollCentroid([aFirst, aSecond]))
            let otherSim = SpeakerEmbedding.cosine(embB, enrollCentroid([aFirst, aSecond]))
            let mid = (ownerSim + otherSim) / 2
            guard let print = SpeakerGate.enroll(fromSamples: [aFirst, aSecond], threshold: mid) else {
                check("enroll owner", false); return
            }
            check("enroll owner → print persisted", SpeakerGate.isEnrolled && print.sampleCount == 2)
            check("loaded print round-trips", SpeakerGate.loadPrint()?.embedding == print.embedding)
            check("gate ACCEPTS the enrolled voice", SpeakerGate.isOwner(a).owner,
                  "sim=\(f(SpeakerGate.isOwner(a).similarity)) thr=\(f(mid))")
            check("gate REJECTS the other voice", !SpeakerGate.isOwner(b).owner,
                  "sim=\(f(SpeakerGate.isOwner(b).similarity)) thr=\(f(mid))")
        }

        // Optional real-WAV mode: --speakertest owner1.wav owner2.wav -- other.wav
        if let (owners, others) = realWavArgs() {
            print("\n— real-WAV mode: enrolling on \(owners.count) owner clip(s) —")
            let ownerBufs = owners.compactMap { AudioWatcher.decodeToMono16k(path: $0) }
            withBackedUpPrint {
                SpeakerGate.clear()
                if let print = SpeakerGate.enroll(fromSamples: ownerBufs) {
                    for p in owners { score("OWNER ", p, print) }
                    for p in others { score("OTHER ", p, print) }
                } else {
                    print("  could not enroll (no voiced audio in owner clips)")
                }
            }
        }

        print("\nSPEAKERTEST: \(pass)/\(pass + fail) checks passed")
        exit(fail == 0 ? 0 : 1)
    }

    // MARK: helpers

    /// Cosine of a decoded clip vs an enrolled print, printed for inspection.
    private static func score(_ label: String, _ path: String, _ print: VoicePrint) {
        guard let buf = AudioWatcher.decodeToMono16k(path: path), let emb = SpeakerEmbedding.embed(buf) else {
            Swift.print("  \(label) \(path) — could not embed"); return
        }
        let sim = SpeakerEmbedding.cosine(emb, print.embedding)
        Swift.print("  \(label) sim=\(f(sim)) \(sim >= print.threshold ? "ACCEPT" : "reject") — \(path)")
    }

    /// L2-normalised centroid of some sample embeddings (mirrors enroll, for the
    /// midpoint-threshold computation).
    private static func enrollCentroid(_ samples: [[Float]]) -> [Float] {
        let embs = samples.compactMap { SpeakerEmbedding.embed($0) }
        guard let first = embs.first else { return [] }
        var c = [Float](repeating: 0, count: first.count)
        for e in embs { for i in 0..<c.count { c[i] += e[i] } }
        var n: Float = 0; for v in c { n += v * v }; n = n.squareRoot()
        if n > 1e-9 { for i in 0..<c.count { c[i] /= n } }
        return c
    }

    /// Run a block with any existing on-disk print backed up and restored after,
    /// so the test never clobbers a real enrollment.
    private static func withBackedUpPrint(_ body: () -> Void) {
        let url = SpeakerGate.printURL
        let backup = try? Data(contentsOf: url)
        body()
        if let backup { try? backup.write(to: url) } else { try? FileManager.default.removeItem(at: url) }
    }

    /// Parse `owner… -- other…` after the `--speakertest` flag.
    private static func realWavArgs() -> (owners: [String], others: [String])? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--speakertest") else { return nil }
        let rest = Array(args[(i + 1)...]).filter { !$0.hasPrefix("--") || $0 == "--" }
        guard let sep = rest.firstIndex(of: "--") else {
            let owners = rest.filter { $0 != "--" }
            return owners.isEmpty ? nil : (owners, [])
        }
        let owners = Array(rest[0..<sep]), others = Array(rest[(sep + 1)...])
        return owners.isEmpty ? nil : (owners, others)
    }

    /// A voiced-speech-like signal: harmonics of F0 shaped by a formant envelope,
    /// with mild vibrato so successive frames vary (as real speech does).
    private static func voiceLike(f0: Double, formants: [Double], seconds: Double, sr: Int = 16_000) -> [Float] {
        let n = Int(seconds * Double(sr))
        var out = [Float](repeating: 0, count: n)
        let harmonics = 40
        for i in 0..<n {
            let t = Double(i) / Double(sr)
            let vib = 1 + 0.01 * sin(2 * Double.pi * 5 * t)   // 5 Hz vibrato
            var s = 0.0
            for h in 1...harmonics {
                let freq = f0 * Double(h) * vib
                if freq >= Double(sr) / 2 { break }
                // Formant envelope: gain peaks near each formant centre.
                var gain = 0.02
                for fmt in formants { gain += 0.5 * exp(-pow(freq - fmt, 2) / (2 * pow(120.0, 2))) }
                s += gain * sin(2 * Double.pi * freq * t) / Double(h)
            }
            out[i] = Float(s * 0.2)
        }
        return out
    }

    private static func f(_ x: Float) -> String { String(format: "%.3f", x) }
}
