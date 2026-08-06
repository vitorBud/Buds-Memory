import Foundation

public enum BudsNativeError: LocalizedError {
    case insufficientStorage(available: Int64, required: Int64)
    case databaseUnavailable(String)
    case modelMissing
    case modelIntegrity
    case modelDownload(String)
    case modelLoad(String)
    case inference(String)
    case thermalBlocked
    case cancelled

    public var errorDescription: String? {
        switch self {
        case let .insufficientStorage(available, required):
            return "Espaço insuficiente. Há \(Self.gigabytes(available)) GB livres e são necessários \(Self.gigabytes(required)) GB."
        case let .databaseUnavailable(message):
            return "O banco local não pôde ser aberto: \(message)"
        case .modelMissing:
            return "O modelo local 4B ainda não foi instalado neste iPhone."
        case .modelIntegrity:
            return "O arquivo do modelo 4B está incompleto ou não passou na verificação de integridade."
        case let .modelDownload(message):
            return "Falha ao baixar o modelo 4B: \(message)"
        case let .modelLoad(message):
            return "Falha ao carregar o modelo 4B: \(message)"
        case let .inference(message):
            return "Falha durante a resposta local: \(message)"
        case .thermalBlocked:
            return "O iPhone está quente. A geração foi pausada para proteger o aparelho."
        case .cancelled:
            return "Geração interrompida."
        }
    }

    private static func gigabytes(_ bytes: Int64) -> String {
        String(format: "%.1f", Double(bytes) / 1_073_741_824)
    }
}

public struct BudsStorageStatus: Sendable {
    public let availableBytes: Int64
    public let usedBytes: Int64
    public let databaseBytes: Int64
    public let warning: Bool
    public let databaseBlocked: Bool
    public let modelDownloadAllowed: Bool

    public init(
        availableBytes: Int64,
        usedBytes: Int64,
        databaseBytes: Int64,
        warning: Bool,
        databaseBlocked: Bool,
        modelDownloadAllowed: Bool
    ) {
        self.availableBytes = availableBytes
        self.usedBytes = usedBytes
        self.databaseBytes = databaseBytes
        self.warning = warning
        self.databaseBlocked = databaseBlocked
        self.modelDownloadAllowed = modelDownloadAllowed
    }
}

public struct BudsRuntimeStatus: Sendable {
    public let storage: BudsStorageStatus
    public let databaseReady: Bool
    public let modelInstalled: Bool
    public let modelBytes: Int64
    public let modelExpectedBytes: Int64
    public let modelRequiredBytes: Int64
    public let modelName: String
    public let thermalState: String
    public let lowPowerMode: Bool

    public init(
        storage: BudsStorageStatus,
        databaseReady: Bool,
        modelInstalled: Bool,
        modelBytes: Int64,
        modelExpectedBytes: Int64,
        modelRequiredBytes: Int64,
        modelName: String,
        thermalState: String,
        lowPowerMode: Bool
    ) {
        self.storage = storage
        self.databaseReady = databaseReady
        self.modelInstalled = modelInstalled
        self.modelBytes = modelBytes
        self.modelExpectedBytes = modelExpectedBytes
        self.modelRequiredBytes = modelRequiredBytes
        self.modelName = modelName
        self.thermalState = thermalState
        self.lowPowerMode = lowPowerMode
    }
}

public struct BudsSessionRecord: Sendable {
    public let id: String
    public let title: String
    public let createdAt: String
}

public struct BudsConversationStorageRecord: Sendable {
    public let id: String
    public let title: String
    public let createdAt: String?
    public let deletedAt: String?
    public let state: String
    public let messageCount: Int
    public let memoryCount: Int
    public let totalRecords: Int
    public let estimatedBytes: Int64
}

public struct BudsMessageRecord: Sendable {
    public let id: Int64
    public let sessionId: String
    public let sender: String
    public let text: String
    public let createdAt: String
}

public struct BudsMemoryRecord: Sendable {
    public let id: Int64
    public let content: String
    public let importance: Double
    public let isCore: Bool
    public let createdAt: String
    public let scope: String
    public let sessionId: String?
}

public struct BudsGenerationMetrics: Sendable {
    public let generationId: String
    public let modelName: String
    public let promptCharacters: Int
    public let historyMessages: Int
    public let memoryItems: Int
    public let promptTokens: Int
    public let outputTokens: Int
    public let loadMilliseconds: Double
    public let timeToFirstTokenMilliseconds: Double
    public let generationMilliseconds: Double
    public let totalMilliseconds: Double
    public let tokensPerSecond: Double
    public let inferenceThreads: Int
    public let batchThreads: Int
    public let residentBytesBefore: UInt64
    public let residentBytesAfter: UInt64
    public let observedPeakBytes: UInt64
    public let processCPUSeconds: Double
    public let thermalStateStart: String
    public let thermalStateEnd: String
}

struct BudsEngineResult {
    let text: String
    let promptTokens: Int
    let outputTokens: Int
    let loadMilliseconds: Double
    let timeToFirstTokenMilliseconds: Double
    let generationMilliseconds: Double
    let totalMilliseconds: Double
    let tokensPerSecond: Double
    let inferenceThreads: Int
    let batchThreads: Int
    let residentBytesBefore: UInt64
    let residentBytesAfter: UInt64
    let observedPeakBytes: UInt64
    let processCPUSeconds: Double
    let thermalStateStart: String
    let thermalStateEnd: String
}
