// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AetherNativeRuntime",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "AetherNativeRuntime", targets: ["AetherNativeRuntime"]),
    ],
    targets: [
        .binaryTarget(
            name: "llama",
            path: "Vendor/llama.xcframework"
        ),
        .target(
            name: "AetherNativeRuntime",
            dependencies: ["llama"],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("Accelerate"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
            ]
        ),
    ]
)
