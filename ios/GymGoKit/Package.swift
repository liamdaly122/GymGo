// swift-tools-version: 6.2
import PackageDescription

// GymGoKit: what the watch needs to run a session on its own, shared by the
// watch app and (later) the iPhone app's native side. Builds and tests on the
// Mac with `swift test`, so the rules are checked without Xcode's interface.
let package = Package(
    name: "GymGoKit",
    platforms: [.iOS(.v26), .watchOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "GymGoKit", targets: ["GymGoKit"])
    ],
    targets: [
        .target(name: "GymGoKit"),
        .testTarget(name: "GymGoKitTests", dependencies: ["GymGoKit"])
    ]
)
