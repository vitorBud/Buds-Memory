import Foundation

public final class BudsLocalRuntime: @unchecked Sendable {
    public static let shared = BudsLocalRuntime()

    public let modelManager: BudsModelManager
    private let inferenceQueue = DispatchQueue(label: "com.budsmemory.ios.inference", qos: .userInitiated)
    private let storeLock = NSLock()
    private var store: BudsLocalStore?
    private let engine = BudsInferenceEngine()
    public lazy var locationMonitor = BudsLocationMonitor(
        onSample: { [weak self] latitude, longitude, accuracy, altitude, speed, recordedAt, source in
            guard let self else { throw BudsNativeError.databaseUnavailable("Runtime de localização indisponível.") }
            return try self.updateLocationSample(
                latitude: latitude, longitude: longitude, accuracyMeters: accuracy,
                altitudeMeters: altitude, speedMetersPerSecond: speed,
                recordedAt: recordedAt, source: source
            )
        },
        onRegion: { [weak self] placeId, entering in
            guard let self else { return }
            _ = try self.recordGeofence(placeId: placeId, entering: entering)
        }
    )
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

    public func createSession(title: String?, folderId: String? = nil) throws -> BudsSessionRecord {
        try ensureStore().createSession(title: title, folderId: folderId)
    }

    public func updateSessionTitle(id: String, title: String) throws -> BudsSessionRecord {
        try ensureStore().updateSessionTitle(id: id, title: title)
    }

    public func updateSessionFolder(id: String, folderId: String?) throws -> BudsSessionRecord {
        try ensureStore().updateSessionFolder(id: id, folderId: folderId)
    }

    public func chatFolders() throws -> [BudsChatFolderRecord] {
        try ensureStore().chatFolders()
    }

    public func createChatFolder(name: String, icon: String, color: String) throws -> BudsChatFolderRecord {
        try ensureStore().createChatFolder(name: name, icon: icon, color: color)
    }

    public func updateChatFolder(id: String, name: String?, icon: String?, color: String?) throws -> BudsChatFolderRecord {
        try ensureStore().updateChatFolder(id: id, name: name, icon: icon, color: color)
    }

    public func deleteChatFolder(id: String) throws {
        try ensureStore().deleteChatFolder(id: id)
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

    public func focusTasks() throws -> [BudsFocusTaskRecord] {
        try ensureStore().focusTasks()
    }

    public func createFocusTask(
        title: String,
        category: String,
        priority: String,
        isFocus: Bool,
        dueDate: String?,
        itemType: String = "TASK",
        placeContext: String = "anywhere",
        triggerOnArrival: Bool = false
    ) throws -> BudsFocusTaskRecord {
        try ensureStore().createFocusTask(
            title: title,
            category: category,
            priority: priority,
            isFocus: isFocus,
            dueDate: dueDate,
            itemType: itemType,
            placeContext: placeContext,
            triggerOnArrival: triggerOnArrival
        )
    }

    public func updateFocusTask(
        id: Int64,
        title: String?,
        category: String?,
        priority: String?,
        completed: Bool?,
        isFocus: Bool?,
        placeContext: String?,
        triggerOnArrival: Bool?
    ) throws -> BudsFocusTaskRecord {
        try ensureStore().updateFocusTask(
            id: id,
            title: title,
            category: category,
            priority: priority,
            completed: completed,
            isFocus: isFocus,
            placeContext: placeContext,
            triggerOnArrival: triggerOnArrival
        )
    }

    public func deleteFocusTask(id: Int64) throws {
        try ensureStore().deleteFocusTask(id: id)
    }

    public func createFocusIdea(content: String) throws {
        try ensureStore().createFocusIdea(content: content)
    }

    public func createFocusDecision(content: String) throws {
        try ensureStore().createFocusDecision(content: content)
    }

    public func focusTimeline() throws -> [BudsFocusTimelineRecord] {
        try ensureStore().focusTimeline()
    }

    public func focusInbox() throws -> [BudsFocusInboxRecord] {
        try ensureStore().focusInbox()
    }

    public func updateFocusInbox(id: Int64, status: String) throws {
        try ensureStore().updateFocusInbox(id: id, status: status)
    }

    public func knownPlaces() throws -> [BudsKnownPlaceRecord] {
        try ensureStore().knownPlaces()
    }

    public func saveKnownPlace(
        id: Int64?, name: String, context: String, latitude: Double,
        longitude: Double, radiusMeters: Double, enabled: Bool
    ) throws -> BudsKnownPlaceRecord {
        try ensureStore().saveKnownPlace(
            id: id, name: name, context: context, latitude: latitude,
            longitude: longitude, radiusMeters: radiusMeters, enabled: enabled
        )
    }

    public func deleteKnownPlace(id: Int64) throws {
        try ensureStore().deleteKnownPlace(id: id)
    }

    public func locationState() throws -> BudsLocationStateRecord {
        try ensureStore().locationState()
    }

    public func locationEvents(limit: Int = 30) throws -> [BudsLocationEventRecord] {
        try ensureStore().locationEvents(limit: limit)
    }

    public func updateLocationSample(
        latitude: Double, longitude: Double, accuracyMeters: Double?,
        altitudeMeters: Double? = nil, speedMetersPerSecond: Double? = nil,
        recordedAt: String? = nil, source: String
    ) throws -> BudsLocationStateRecord {
        try ensureStore().updateLocationSample(
            latitude: latitude, longitude: longitude,
            accuracyMeters: accuracyMeters, altitudeMeters: altitudeMeters,
            speedMetersPerSecond: speedMetersPerSecond, recordedAt: recordedAt,
            source: source
        )
    }

    public func locationRoutes(limit: Int = 30) throws -> [BudsLocationRouteRecord] {
        try ensureStore().locationRoutes(limit: limit)
    }

    public func activeLocationRoute() throws -> BudsLocationRouteRecord? {
        try ensureStore().activeLocationRoute()
    }

    public func locationRoute(id: Int64) throws -> BudsLocationRouteRecord? {
        try ensureStore().locationRoute(id: id)
    }

    public func startLocationRoute(name: String?) throws -> BudsLocationRouteRecord {
        let route = try ensureStore().startLocationRoute(name: name)
        locationMonitor.startRouteTracking()
        return route
    }

    public func finishLocationRoute() throws -> BudsLocationRouteRecord? {
        locationMonitor.stopRouteTracking()
        return try ensureStore().finishLocationRoute()
    }

    public func deleteLocationRoute(id: Int64) throws {
        if try ensureStore().activeLocationRoute()?.id == id {
            locationMonitor.stopRouteTracking()
        }
        try ensureStore().deleteLocationRoute(id: id)
    }

    public func setSemanticLocationContext(_ context: String) throws -> BudsLocationStateRecord {
        try ensureStore().setSemanticLocationContext(context)
    }

    public func recordGeofence(placeId: Int64, entering: Bool) throws -> BudsLocationStateRecord {
        try ensureStore().recordGeofence(placeId: placeId, entering: entering)
    }

    public func requestCurrentLocation() async throws -> BudsLocationStateRecord {
        try await locationMonitor.requestCurrentLocation()
    }

    public func configureLocationMonitoring(enabled: Bool) throws -> (enabled: Bool, authorization: String) {
        let places = try knownPlaces()
        locationMonitor.configure(enabled: enabled, places: places)
        return (enabled, locationMonitor.authorizationName)
    }

    public func refreshLocationRegions() throws {
        locationMonitor.refreshRegions(try knownPlaces())
    }

    public func analyzeFocusInput(_ text: String) async throws -> [[String: Any]] {
        let deterministic = BudsFocusCapture.detect(text)
        if !deterministic.isEmpty {
            return deterministic.map { candidate in
                var item: [String: Any] = [
                    "type": candidate.itemType,
                    "content": candidate.content,
                    "action": ["TASK", "REMINDER"].contains(candidate.itemType) ? "create_task" : (
                        candidate.itemType == "IDEA" ? "save_idea" : candidate.itemType == "DECISION" ? "save_decision" : "none"
                    ),
                    "category": candidate.category,
                    "priority": candidate.priority,
                    "confidence": candidate.confidence,
                    "place_context": candidate.placeContext,
                    "trigger_on_arrival": candidate.triggerOnArrival,
                ]
                if let dueDate = candidate.dueDate { item["due_date"] = dueDate }
                return item
            }
        }
        let tasks = try focusTasks().filter { !$0.completed }
        let taskContext = tasks.isEmpty
            ? "(nenhuma tarefa aberta)"
            : tasks.map { "ID: \($0.id) | Título: \($0.title)" }.joined(separator: "\n")
        let prompt = """
        Você é o classificador local do Buds Focus. Converta a atualização do usuário em JSON.
        Responda somente com este formato: {"items":[{"type":"TASK|REMINDER|UPDATE|IDEA|DECISION|MEMORY|IGNORE","content":"texto curto","action":"complete_task|create_task|save_idea|save_decision|save_memory|none","related_task_id":1,"category":"work|study|personal|project|other","priority":"low|medium|high","due_date":"2026-08-11T09:00","place_context":"home|work|gym|study|other|anywhere","trigger_on_arrival":false,"confidence":0.9}]}.
        Use UPDATE/complete_task somente quando a mensagem disser que uma tarefa aberta foi concluída e houver ID correspondente.
        Tarefas abertas:
        \(taskContext)
        Atualização do usuário:
        \(text)
        """
        let response = try await runFocusPrompt(BudsPromptBuilder.buildFocus(instruction: prompt))
        return try Self.parseFocusItems(response)
    }

    public func focusThink(_ query: String) async throws -> String {
        let tasks = try focusTasks()
        let open = tasks.filter { !$0.completed }
        let completed = tasks.filter { $0.completed && $0.updatedAt.hasPrefix(String(Self.todayPrefix)) }
        let openText = open.isEmpty
            ? "(nenhuma)"
            : open.map { "- \($0.title) (\($0.priority), \($0.category), lugar: \($0.placeContext))" }.joined(separator: "\n")
        let completedText = completed.isEmpty
            ? "(nenhuma)"
            : completed.map { "- \($0.title)" }.joined(separator: "\n")
        let locationContext = try semanticLocationPrompt()
        let prompt = """
        Você é o Buds Memory no modo Focus. Ajude o usuário a escolher prioridades sem criar tarefas automaticamente.
        Tarefas abertas:
        \(openText)
        Tarefas concluídas hoje:
        \(completedText)
        \(locationContext)
        Pergunta:
        \(query)
        Responda em português, de forma humana, direta, curta e útil.
        """
        do {
            let response = BudsVisibleResponseFilter.sanitize(
                try await runFocusPrompt(BudsPromptBuilder.buildFocus(instruction: prompt))
            )
            if !response.isEmpty { return response }
        } catch {
            // Buds Think continua útil mesmo quando o modelo está ocupado,
            // ausente ou sob pressão térmica.
        }
        return Self.focusBrief(open: open, completedToday: completed)
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
        var memories: [BudsMemoryRecord]
        do {
            store = try ensureStore()
            _ = try store.addMessage(sessionId: sessionId, sender: "user", text: text)
            history = try store.messages(sessionId: sessionId, limit: 24)
            memories = try store.memoriesForPrompt(sessionId: sessionId, limit: 16)
            if Self.shouldUseLocationContext(for: text) {
                let context = try store.locationState()
                if !["unknown", "away"].contains(context.context) {
                    let label = context.placeName ?? context.context
                    memories.append(BudsMemoryRecord(
                        id: -1,
                        content: "Contexto de lugar atual: \(label) (\(context.context)). Use somente se for relevante; não mencione coordenadas.",
                        importance: 1,
                        isCore: false,
                        createdAt: context.updatedAt ?? "",
                        scope: "session",
                        sessionId: sessionId
                    ))
                }
                let route = try store.activeLocationRoute() ?? store.locationRoutes(limit: 1).first
                if let route {
                    let distance = String(format: "%.2f", route.distanceMeters / 1_000)
                    let minutes = route.durationSeconds / 60
                    let state = route.status == "active" ? "em gravação" : "concluído"
                    memories.append(BudsMemoryRecord(
                        id: -2,
                        content: "Resumo local do trajeto mais recente, sem coordenadas: \(route.name); \(distance) km; \(minutes) min; \(state).",
                        importance: 1,
                        isCore: false,
                        createdAt: route.startedAt,
                        scope: "session",
                        sessionId: sessionId
                    ))
                }
            }
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

    private func runFocusPrompt(_ prompt: String) async throws -> String {
        guard modelManager.isInstalled else { throw BudsNativeError.modelMissing }
        let generationId = "focus-\(UUID().uuidString.lowercased())"
        generationLock.lock()
        guard activeGeneration == nil else {
            generationLock.unlock()
            throw BudsNativeError.inference("aguarde a resposta atual terminar antes de usar o Focus")
        }
        activeGeneration = (generationId, "__focus__")
        generationLock.unlock()

        return try await withCheckedThrowingContinuation { continuation in
            inferenceQueue.async { [engine, modelManager] in
                do {
                    let result = try engine.generate(
                        prompt: prompt,
                        modelURL: modelManager.modelURL,
                        onToken: { _ in }
                    )
                    self.finishGeneration(generationId)
                    continuation.resume(returning: result.text)
                } catch {
                    self.finishGeneration(generationId)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func parseFocusItems(_ response: String) throws -> [[String: Any]] {
        guard let start = response.firstIndex(of: "{"),
              let end = response.lastIndex(of: "}"),
              start <= end,
              let data = String(response[start...end]).data(using: .utf8),
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawItems = root["items"] as? [[String: Any]] else {
            throw BudsNativeError.inference("não foi possível interpretar a organização sugerida")
        }
        let allowedTypes = Set(["TASK", "REMINDER", "UPDATE", "IDEA", "DECISION", "MEMORY", "IGNORE"])
        let allowedActions = Set(["complete_task", "create_task", "save_idea", "save_decision", "save_memory", "none"])
        let allowedCategories = Set(["work", "study", "personal", "project", "other"])
        let allowedPriorities = Set(["low", "medium", "high"])
        let allowedPlaces = Set(["home", "work", "gym", "study", "other", "anywhere"])
        return rawItems.compactMap { item in
            guard let content = (item["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !content.isEmpty else { return nil }
            let rawType = (item["type"] as? String)?.uppercased() ?? "IGNORE"
            let type = allowedTypes.contains(rawType) ? rawType : "IGNORE"
            let rawAction = item["action"] as? String ?? "none"
            let defaultAction: String
            switch type {
            case "TASK", "REMINDER": defaultAction = "create_task"
            case "IDEA": defaultAction = "save_idea"
            case "DECISION": defaultAction = "save_decision"
            case "MEMORY": defaultAction = "save_memory"
            default: defaultAction = "none"
            }
            var action = allowedActions.contains(rawAction) ? rawAction : defaultAction
            if action == "none", defaultAction != "none" { action = defaultAction }
            var clean: [String: Any] = [
                "type": type,
                "content": String(content.prefix(2_000)),
                "action": action,
            ]
            if let relatedId = item["related_task_id"] as? NSNumber {
                clean["related_task_id"] = relatedId.int64Value
            } else if type == "UPDATE" {
                clean["action"] = "none"
            }
            if let category = item["category"] as? String, allowedCategories.contains(category) {
                clean["category"] = category
            }
            if let priority = item["priority"] as? String, allowedPriorities.contains(priority) {
                clean["priority"] = priority
            }
            if let confidence = item["confidence"] as? NSNumber {
                clean["confidence"] = min(1, max(0, confidence.doubleValue))
            }
            if let dueDate = item["due_date"] as? String, !dueDate.isEmpty {
                clean["due_date"] = dueDate
            }
            if let place = item["place_context"] as? String, allowedPlaces.contains(place) {
                clean["place_context"] = place
                clean["trigger_on_arrival"] = (item["trigger_on_arrival"] as? Bool ?? false) && place != "anywhere"
            }
            return clean
        }
    }

    private func semanticLocationPrompt() throws -> String {
        let state = try locationState()
        guard !["unknown", "away"].contains(state.context) else { return "" }
        let label = state.placeName ?? state.context
        return "Contexto de lugar atual: \(label) (\(state.context)). Use somente quando ajudar a priorizar; nunca mencione coordenadas."
    }

    private static func shouldUseLocationContext(for text: String) -> Bool {
        let value = text.folding(options: .diacriticInsensitive, locale: .current).lowercased()
        return ["casa", "trabalho", "academia", "faculdade", "localizacao", "onde estou", "chegar", "sair", "focus", "tarefa", "lembrete", "trajeto", "caminho", "percurso", "rota"]
            .contains { value.contains($0) }
    }

    private static func focusBrief(open: [BudsFocusTaskRecord], completedToday: [BudsFocusTaskRecord]) -> String {
        guard !open.isEmpty else {
            return completedToday.isEmpty
                ? "Seu Focus está livre. Coloque aqui apenas o próximo passo que realmente importa hoje."
                : "Você concluiu \(completedToday.count) item(ns) hoje e não há pendências abertas. Bom momento para revisar a Buds Inbox."
        }
        let sorted = open.sorted { left, right in
            let score = ["high": 0, "medium": 1, "low": 2]
            if left.isFocus != right.isFocus { return left.isFocus }
            return (score[left.priority] ?? 1) < (score[right.priority] ?? 1)
        }
        let first = sorted[0]
        let remainder = max(0, open.count - 1)
        return remainder == 0
            ? "Comece por “\(first.title)”. É o único item aberto; conclua-o antes de adicionar mais coisas."
            : "Comece por “\(first.title)”. Depois, revise os outros \(remainder) item(ns) abertos e adie o que não cabe hoje."
    }

    private static var todayPrefix: Substring {
        ISO8601DateFormatter().string(from: Date()).prefix(10)
    }

    public func unloadModel() {
        inferenceQueue.async { [engine] in engine.unload() }
    }

    public func clearAllData() throws -> BudsRuntimeStatus {
        locationMonitor.configure(enabled: false, places: [])
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
