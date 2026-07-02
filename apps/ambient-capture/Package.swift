// swift-tools-version:5.9
// F201.3 — Trail Ambient capture agent (macOS menubar app, no Dock icon).
// Built with SPM + scripts/bundle.sh (assembles the .app bundle); the
// package.json `build` script is the turbo entry point.
import PackageDescription

let package = Package(
    name: "TrailAmbient",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "TrailAmbient",
            path: "Sources/TrailAmbient"
        )
    ]
)
