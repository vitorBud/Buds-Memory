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
        .target(
            name: "BudsNativeRuntime",
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
