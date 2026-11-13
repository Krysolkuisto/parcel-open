// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ParcelOpen",
    defaultLocalization: "en",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "ParcelKit", targets: ["ParcelKit"]),
        .library(name: "ParcelWidget", targets: ["ParcelWidget"]),
        .executable(name: "ParcelOpen", targets: ["ParcelOpen"]),
    ],
    targets: [
        // Shared by the app and the widget: models, API client, settings, status styling, translations.
        .target(name: "ParcelKit", resources: [.process("Resources")]),
        // The widget itself. The @main bundle lives in Extension/ and is only compiled by the Xcode project.
        .target(name: "ParcelWidget", dependencies: ["ParcelKit"]),
        // The SwiftUI app (macOS and iOS). Runnable on macOS with `swift run`.
        .executableTarget(name: "ParcelOpen", dependencies: ["ParcelKit"]),
        .testTarget(name: "ParcelKitTests", dependencies: ["ParcelKit"]),
    ]
)
