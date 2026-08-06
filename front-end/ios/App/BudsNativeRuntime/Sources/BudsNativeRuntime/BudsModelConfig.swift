import Foundation

public enum BudsModelConfig {
    // Identity
    public static let modelId = "qwen3.5-4b"
    public static let modelDisplayName = "Qwen3.5 4B"
    public static let modelFileName = "qwen3.5-4b-instruct-Q4_K_M.gguf"
    public static let expectedBytes: Int64 = 2_708_804_384
    public static let expectedSHA256 = "2e3c607324e016a3f59bced47a5fa411330f1a252d18ad0237caded161f12b45"

    // Download
    public static let downloadURL = URL(string: "https://huggingface.co/openresearchtools/Qwen3.5-4B-Instruct-GGUF/resolve/main/qwen3.5-4b-instruct-Q4_K_M.gguf")!

    // Limits
    public static let maxContextWindow: Int32 = 4096  // Mobile conservative context
    public static let maxTokensPerGeneration: Int32 = 768

    // Generation Params
    public static let temperature: Float = 0.7
    public static let topP: Float = 0.8
    public static let topK: Int32 = 20
    public static let minP: Float = 0.0
    public static let presencePenalty: Float = 1.5
    public static let repeatPenalty: Float = 1.0

    // Capabilities
    public static let enableThinking = false // Prioritizar eficiência e velocidade
}
