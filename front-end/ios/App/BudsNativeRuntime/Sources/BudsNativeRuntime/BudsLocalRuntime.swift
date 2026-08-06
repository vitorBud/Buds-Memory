import Foundation

public final class BudsLocalRuntime: @unchecked Sendable {
    public static let shared = BudsLocalRuntime()

    public let modelManager: BudsModelManager
    private let inferenceQueue = DispatchQueue(label: "com.budsmemory.ios.inference", qos: .userInitiated)
    private let storeLock = NSLock()
    private var store: BudsLocalStore?
    private let engine = BudsInferenceEngine()
    private let generationLock = NSLock()
    private var activeGeneration: (id: String, sessionId: String)?

    private init() {
        do {
            modelManager = try BudsModelManager()
        } catch {
            fatalError("Buds model directory unavailable: \(error.localizedDescription)")
        }
    }

    public func status() -> BudsRuntimeStatus {
        let storage = BudsStorageGuard.status()
        var databaseReady = false
        if !storage.databaseBlocked {
            databaseReady = (try? ensureStore()) != nil
        }
        return BudsRuntimeStatus(
            storage: storage,
            databaseReady: databaseReady,
            modelInstalled: modelManager.isInstalled,
            modelBytes: modelManager.installedBytes,
            modelExpectedBytes: BudsStorageGuard.modelBytes,
            modelRequiredBytes: BudsStorageGuard.modelRequiredBytes,
            modelName: BudsModelManager.modelName,
            thermalState: Self.thermalStateName,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled
        )
    }

    public func listSessions() throws -> [BudsSessionRecord] {
        try ensureStore().listSessions()
    }

    public func createSession(title: String?) throws -> BudsSessionRecord {
        try ensureStore().createSession(title: title)
    }

    public func updateSessionTitle(id: String, title: String) throws -> BudsSessionRecord {
        try ensureStore().updateSessionTitle(id: id, title: title)
    }

    public func deleteSession(id: String) throws {
        generationLock.lock()
        let shouldCancel = activeGeneration?.sessionId == id
        generationLock.unlock()
        if shouldCancel { cancelGeneration() }
        try ensureStore().deleteSession(id: id)
    }

    public func conversationStorage() throws -> [BudsConversationStorageRecord] {
        try ensureStore().conversationStorage()
    }

    public func purgeConversation(id: String) throws {
        generationLock.lock()
        let shouldCancel = activeGeneration?.sessionId == id
        generationLock.unlock()
        if shouldCancel { cancelGeneration() }
        try ensureStore().purgeConversation(id: id)
    }

    public func messages(sessionId: String) throws -> [BudsMessageRecord] {
        try ensureStore().messages(sessionId: sessionId).compactMap { message in
            guard message.sender == "ia" else { return message }
            let visibleText = BudsVisibleResponseFilter.sanitize(message.text)
            guard !visibleText.isEmpty else { return nil }
            return BudsMessageRecord(
                id: message.id,
                sessionId: message.sessionId,
                sender: message.sender,
                text: visibleText,
                createdAt: message.createdAt
            )
        }
    }

    public func memories(limit: Int) throws -> [BudsMemoryRecord] {
        try ensureStore().memories(limit: limit)
    }

    public func createMemory(content: String, importance: Double) throws -> BudsMemoryRecord {
        try ensureStore().createMemory(content: content, importance: importance)
    }

    public func updateMemory(id: Int64, content: String?, importance: Double?) throws -> BudsMemoryRecord {
        try ensureStore().updateMemory(id: id, content: content, importance: importance)
    }

    public func setCoreMemory(id: Int64, enabled: Bool) throws -> BudsMemoryRecord {
        try ensureStore().setCoreMemory(id: id, enabled: enabled)
    }

    public func deleteMemory(id: Int64, force: Bool) throws {
        try ensureStore().deleteMemory(id: id, force: force)
    }

    public func generate(
        generationId: String,
        sessionId: String,
        text: String,
        onToken: @escaping @Sendable (String) -> Void
    ) async throws -> (text: String, session: BudsSessionRecord?, metrics: BudsGenerationMetrics) {
        guard modelManager.isInstalled else { throw BudsNativeError.modelMissing }
        generationLock.lock()
        let hadActiveGeneration = activeGeneration != nil
        activeGeneration = (generationId, sessionId)
        generationLock.unlock()
        if hadActiveGeneration { engine.cancel() }
        let store: BudsLocalStore
        let history: [BudsMessageRecord]
        let memories: [BudsMemoryRecord]
        do {
            store = try ensureStore()
            _ = try store.addMessage(sessionId: sessionId, sender: "user", text: text)
            history = try store.messages(sessionId: sessionId, limit: 24)
            memories = try store.memoriesForPrompt(sessionId: sessionId, limit: 16)
        } catch {
            finishGeneration(generationId)
            throw error
        }
        let prompt = BudsPromptBuilder.build(history: history, memories: memories)

        return try await withCheckedThrowingContinuation { continuation in
            inferenceQueue.async { [engine, modelManager] in
                do {
                    guard self.isActiveGeneration(generationId, sessionId: sessionId) else {
                        throw BudsNativeError.cancelled
                    }
                    let engineResult = try engine.generate(
                        prompt: prompt,
                        modelURL: modelManager.modelURL,
                        onToken: { token in
                            if self.isActiveGeneration(generationId, sessionId: sessionId) {
                                onToken(token)
                            }
                        }
                    )
                    let answer = engineResult.text
                    guard !answer.isEmpty else {
                        throw BudsNativeError.inference("o modelo encerrou sem produzir texto")
                    }
                    guard self.isActiveGeneration(generationId, sessionId: sessionId) else {
                        throw BudsNativeError.cancelled
                    }
                    _ = try store.addMessage(sessionId: sessionId, sender: "ia", text: answer)
                    let session = try store.getSession(id: sessionId)
                    let metrics = BudsGenerationMetrics(
                        generationId: generationId,
                        modelName: BudsModelManager.modelName,
                        promptCharacters: prompt.count,
                        historyMessages: history.count,
                        memoryItems: memories.count,
                        promptTokens: engineResult.promptTokens,
                        outputTokens: engineResult.outputTokens,
                        loadMilliseconds: engineResult.loadMilliseconds,
                        timeToFirstTokenMilliseconds: engineResult.timeToFirstTokenMilliseconds,
                        generationMilliseconds: engineResult.generationMilliseconds,
                        totalMilliseconds: engineResult.totalMilliseconds,
                        tokensPerSecond: engineResult.tokensPerSecond,
                        inferenceThreads: engineResult.inferenceThreads,
                        batchThreads: engineResult.batchThreads,
                        residentBytesBefore: engineResult.residentBytesBefore,
                        residentBytesAfter: engineResult.residentBytesAfter,
                        observedPeakBytes: engineResult.observedPeakBytes,
                        processCPUSeconds: engineResult.processCPUSeconds,
                        thermalStateStart: engineResult.thermalStateStart,
                        thermalStateEnd: engineResult.thermalStateEnd
                    )
                    self.finishGeneration(generationId)
                    continuation.resume(returning: (answer, session, metrics))
                } catch {
                    self.finishGeneration(generationId)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    public func cancelGeneration(generationId: String? = nil) {
        generationLock.lock()
        if let generationId, activeGeneration?.id != generationId {
            generationLock.unlock()
            return
        }
        activeGeneration = nil
        generationLock.unlock()
        engine.cancel()
    }

    private func isActiveGeneration(_ id: String, sessionId: String) -> Bool {
        generationLock.lock()
        defer { generationLock.unlock() }
        return activeGeneration?.id == id && activeGeneration?.sessionId == sessionId
    }

    private func finishGeneration(_ id: String) {
        generationLock.lock()
        if activeGeneration?.id == id { activeGeneration = nil }
        generationLock.unlock()
    }

    public func unloadModel() {
        inferenceQueue.async { [engine] in engine.unload() }
    }

    public func clearAllData() throws -> BudsRuntimeStatus {
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

    private func ensureStore() throws -> BudsLocalStore {
        try BudsStorageGuard.requireDatabaseSpace()
        storeLock.lock()
        defer { storeLock.unlock() }
        if let store { return store }
        let created = try BudsLocalStore()
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
