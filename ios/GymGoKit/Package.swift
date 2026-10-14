// swift-tools-version: 6.2
import PackageDescription

// GymGoKit: what the watch needs to run a session on its own.
//
// - GymGoKit: the snapshot the phone sends, the three rules the watch keeps
//   for itself, and the session model. Builds and tests on the Mac with
//   `swift test`, so the rules are checked without Xcode's interface.
// - GymGoWatchUI: the watch's screens, styled like the app. The watch target
//   in App.xcodeproj is a thin shell around it.
let package = Package(
    name: "GymGoKit",
    platforms: [.iOS(.v26), .watchOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "GymGoKit", targets: ["GymGoKit"]),
        .library(name: "GymGoWatchUI", targets: ["GymGoWatchUI"])
    ],
    targets: [
        .target(name: "GymGoKit"),
        .target(
            name: "GymGoWatchUI",
            dependencies: ["GymGoKit"],
            resources: [.process("Fonts")]
        ),
        .testTarget(name: "GymGoKitTests", dependencies: ["GymGoKit"])
    ]
)
