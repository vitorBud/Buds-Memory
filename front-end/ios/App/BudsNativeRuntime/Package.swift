// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BudsNativeRuntime",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "BudsNativeRuntime", targets: ["BudsNativeRuntime"]),
    ],
    targets: [
        .binaryTarget(
            name: "llama",
            path: "Vendor/llama.xcframework"
        ),
        .binaryTarget(
            name: "SherpaOnnxC",
            path: "Vendor/SherpaOnnxC.xcframework"
        ),
        .binaryTarget(
            name: "OnnxRuntimeC",
            path: "Vendor/OnnxRuntimeC.xcframework"
        ),
        .target(
            name: "BudsNativeRuntime",
            dependencies: ["llama", "SherpaOnnxC", "OnnxRuntimeC"],
            resources: [
                .copy("Resources/Kokoro"),
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedLibrary("c++"),
                .linkedLibrary("z"),
                .linkedFramework("Accelerate"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
                .linkedFramework("CoreLocation"),
            ]
        ),
    ]
)
