import Foundation

public final class AetherLocalRuntime: @unchecked Sendable {
    public static let shared = AetherLocalRuntime()

    public let modelManager: AetherModelManager
    private let inferenceQueue = DispatchQueue(label: "com.aethermemory.ios.inference", qos: .userInitiated)
    private let storeLock = NSLock()
    private var store: AetherLocalStore?
    private let engine = AetherInferenceEngine()

    private init() {
        do {
            modelManager = try AetherModelManager()
        } catch {
            fatalError("Aether model directory unavailable: \(error.localizedDescription)")
        }
    }

    public func status() -> AetherRuntimeStatus {
        let storage = AetherStorageGuard.status()
        var databaseReady = false
        if !storage.databaseBlocked {
            databaseReady = (try? ensureStore()) != nil
        }
        return AetherRuntimeStatus(
            storage: storage,
            databaseReady: databaseReady,
            modelInstalled: modelManager.isInstalled,
            modelBytes: modelManager.installedBytes,
            modelName: AetherModelManager.modelName,
            thermalState: Self.thermalStateName,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled
        )
    }

    public func listSessions() throws -> [AetherSessionRecord] {
        try ensureStore().listSessions()
    }

    public func createSession(title: String?) throws -> AetherSessionRecord {
        try ensureStore().createSession(title: title)
    }

    public func updateSessionTitle(id: String, title: String) throws -> AetherSessionRecord {
        try ensureStore().updateSessionTitle(id: id, title: title)
    }

    public func deleteSession(id: String) throws {
        try ensureStore().deleteSession(id: id)
    }

    public func messages(sessionId: String) throws -> [AetherMessageRecord] {
        try ensureStore().messages(sessionId: sessionId)
    }

    public func memories(limit: Int) throws -> [AetherMemoryRecord] {
        try ensureStore().memories(limit: limit)
    }

    public func createMemory(content: String, importance: Double) throws -> AetherMemoryRecord {
        try ensureStore().createMemory(content: content, importance: importance)
    }

    public func updateMemory(id: Int64, content: String?, importance: Double?) throws -> AetherMemoryRecord {
        try ensureStore().updateMemory(id: id, content: content, importance: importance)
    }

    public func setCoreMemory(id: Int64, enabled: Bool) throws -> AetherMemoryRecord {
        try ensureStore().setCoreMemory(id: id, enabled: enabled)
    }

    public func deleteMemory(id: Int64, force: Bool) throws {
        try ensureStore().deleteMemory(id: id, force: force)
    }

    public func generate(
        sessionId: String,
        text: String,
        onToken: @escaping @Sendable (String) -> Void
    ) async throws -> (text: String, session: AetherSessionRecord?) {
        guard modelManager.isInstalled else { throw AetherNativeError.modelMissing }
        let store = try ensureStore()
        _ = try store.addMessage(sessionId: sessionId, sender: "user", text: text)
        let history = try store.messages(sessionId: sessionId, limit: 24)
        let memories = try store.memories(limit: 16)
        let prompt = AetherPromptBuilder.build(history: history, memories: memories)

        return try await withCheckedThrowingContinuation { continuation in
            inferenceQueue.async { [engine, modelManager] in
                do {
                    let answer = try engine.generate(
                        prompt: prompt,
                        modelURL: modelManager.modelURL,
                        onToken: onToken
                    )
                    guard !answer.isEmpty else {
                        throw AetherNativeError.inference("o modelo encerrou sem produzir texto")
                    }
                    _ = try store.addMessage(sessionId: sessionId, sender: "ia", text: answer)
                    let session = try store.getSession(id: sessionId)
                    continuation.resume(returning: (answer, session))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    public func cancelGeneration() {
        engine.cancel()
    }

    public func unloadModel() {
        inferenceQueue.async { [engine] in engine.unload() }
    }

    public func clearAllData() throws -> AetherRuntimeStatus {
        engine.cancel()
        inferenceQueue.sync { [engine] in engine.unload() }

        storeLock.lock()
        let currentStore = store
        storeLock.unlock()

        if let currentStore {
            try currentStore.clearAllData()
        }
        try modelManager.removeInstalledModel()

        // Sem uma conexão anterior, remover o modelo primeiro libera espaço
        // suficiente para abrir e limpar o pequeno banco local.
        if currentStore == nil {
            try ensureStore().clearAllData()
        }
        return status()
    }

    private func ensureStore() throws -> AetherLocalStore {
        try AetherStorageGuard.requireDatabaseSpace()
        storeLock.lock()
        defer { storeLock.unlock() }
        if let store { return store }
        let created = try AetherLocalStore()
        store = created
        return created
    }

    private static var thermalStateName: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }
}
