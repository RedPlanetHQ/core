// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "core-voice",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "core-voice", targets: ["CoreVoice"]),
    ],
    targets: [
        .executableTarget(
            name: "CoreVoice",
            path: "Sources/CoreVoice"
        ),
    ]
)
