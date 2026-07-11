// swift-tools-version:5.9
// F201.3 — Trail Ambient capture agent (macOS menubar app, no Dock icon).
// Built with SPM + scripts/bundle.sh (assembles the .app bundle); the
// package.json `build` script is the turbo entry point.
import PackageDescription

let package = Package(
    name: "TrailAmbient",
    platforms: [.macOS(.v14)],
    dependencies: [
        // F201.6.2 — on-device Whisper STT (CoreML/Neural Engine, $0, no cloud).
        // Chosen over Apple's SFSpeechRecognizer for markedly better Danish.
        .package(url: "https://github.com/argmaxinc/WhisperKit", from: "0.9.0"),
        // F201.6.6 — on-device speaker embedding (CoreML/ANE, 256-d). Classical
        // MFCC-stats were channel-dominated (owner scored 0.535 across sessions);
        // FluidAudio's trained embedding is channel-robust AND discriminative.
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4"),
    ],
    targets: [
        .executableTarget(
            name: "TrailAmbient",
            dependencies: [
                .product(name: "WhisperKit", package: "WhisperKit"),
                .product(name: "FluidAudio", package: "FluidAudio"),
            ],
            path: "Sources/TrailAmbient"
        )
    ]
)
