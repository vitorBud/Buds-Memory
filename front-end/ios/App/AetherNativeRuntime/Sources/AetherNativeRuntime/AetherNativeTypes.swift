import Foundation

public enum AetherNativeError: LocalizedError {
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
            return "O modelo local 7B ainda não foi instalado neste iPhone."
        case .modelIntegrity:
            return "O arquivo do modelo 7B está incompleto ou não passou na verificação de integridade."
        case let .modelDownload(message):
            return "Falha ao baixar o modelo 7B: \(message)"
        case let .modelLoad(message):
            return "Falha ao carregar o modelo 7B: \(message)"
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

public struct AetherStorageStatus: Sendable {
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

public struct AetherRuntimeStatus: Sendable {
    public let storage: AetherStorageStatus
    public let databaseReady: Bool
    public let modelInstalled: Bool
    public let modelBytes: Int64
    public let modelName: String
    public let thermalState: String
    public let lowPowerMode: Bool

    public init(
        storage: AetherStorageStatus,
        databaseReady: Bool,
        modelInstalled: Bool,
        modelBytes: Int64,
        modelName: String,
        thermalState: String,
        lowPowerMode: Bool
    ) {
        self.storage = storage
        self.databaseReady = databaseReady
        self.modelInstalled = modelInstalled
        self.modelBytes = modelBytes
        self.modelName = modelName
        self.thermalState = thermalState
        self.lowPowerMode = lowPowerMode
    }
}

public struct AetherSessionRecord: Sendable {
    public let id: String
    public let title: String
    public let createdAt: String
}

public struct AetherMessageRecord: Sendable {
    public let id: Int64
    public let sessionId: String
    public let sender: String
    public let text: String
    public let createdAt: String
}

public struct AetherMemoryRecord: Sendable {
    public let id: Int64
    public let content: String
    public let importance: Double
    public let isCore: Bool
    public let createdAt: String
}
