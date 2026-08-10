import BudsNativeRuntime
import Capacitor
import Foundation
import UserNotifications

@objc(BudsLocalPlugin)
public final class BudsLocalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BudsLocalPlugin"
    public let jsName = "BudsLocal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelModelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAllData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSessions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSessionTitle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listConversationStorage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purgeConversation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMessages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMemories", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createMemory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateMemory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCoreMemory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteMemory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFocusTasks", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createFocusTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFocusTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFocusTask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyzeFocusInput", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "focusThink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFocusIdea", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFocusDecision", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFocusTimeline", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFocusInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateFocusInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncFocusNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopGeneration", returnType: CAPPluginReturnPromise),
    ]

    private let runtime = BudsLocalRuntime.shared
    private let speechRecognizer = BudsSpeechRecognizer()

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusPayload(runtime.status()))
    }

    @objc func downloadModel(_ call: CAPPluginCall) {
        Task { [weak self] in
            guard let self else { return }
            do {
                try await runtime.modelManager.download { [weak self] progress in
                    DispatchQueue.main.async {
                        self?.notifyListeners("modelDownloadProgress", data: [
                            "progress": progress,
                            "downloadedBytes": Int64(progress * Double(BudsStorageGuard.modelBytes)),
                            "totalBytes": BudsStorageGuard.modelBytes,
                        ])
                    }
                }
                call.resolve(statusPayload(runtime.status()))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func cancelModelDownload(_ call: CAPPluginCall) {
        runtime.modelManager.cancelDownload()
        call.resolve()
    }

    @objc func clearAllData(_ call: CAPPluginCall) {
        guard call.getString("confirmation") == "APAGAR TUDO" else {
            call.reject("Digite exatamente \"APAGAR TUDO\" para confirmar.")
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                call.resolve(statusPayload(try runtime.clearAllData()))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func listSessions(_ call: CAPPluginCall) {
        resolve(call) {
            ["sessions": try runtime.listSessions().map(sessionPayload)]
        }
    }

    @objc func createSession(_ call: CAPPluginCall) {
        resolve(call) {
            sessionPayload(try runtime.createSession(title: call.getString("title")))
        }
    }

    @objc func updateSessionTitle(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let title = call.getString("title") else {
            call.reject("Conversa e título são obrigatórios.")
            return
        }
        resolve(call) {
            sessionPayload(try runtime.updateSessionTitle(id: id, title: title))
        }
    }

    @objc func deleteSession(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Conversa não informada.")
            return
        }
        resolve(call) {
            try runtime.deleteSession(id: id)
            return [:]
        }
    }

    @objc func listConversationStorage(_ call: CAPPluginCall) {
        resolve(call) {
            ["conversations": try runtime.conversationStorage().map(conversationStoragePayload)]
        }
    }

    @objc func purgeConversation(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              call.getString("confirmation") == "APAGAR:\(id)" else {
            call.reject("Confirmação inválida para a exclusão desta conversa.")
            return
        }
        resolve(call) {
            try runtime.purgeConversation(id: id)
            return ["conversations": try runtime.conversationStorage().map(conversationStoragePayload)]
        }
    }

    @objc func getMessages(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("Conversa não informada.")
            return
        }
        resolve(call) {
            ["messages": try runtime.messages(sessionId: sessionId).map(messagePayload)]
        }
    }

    @objc func getMemories(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 80
        resolve(call) {
            ["memories": try runtime.memories(limit: limit).map(memoryPayload)]
        }
    }

    @objc func createMemory(_ call: CAPPluginCall) {
        guard let content = call.getString("content") else {
            call.reject("Conteúdo da memória não informado.")
            return
        }
        resolve(call) {
            memoryPayload(try runtime.createMemory(
                content: content,
                importance: call.getDouble("importance") ?? 0.75
            ))
        }
    }

    @objc func updateMemory(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Memória não informada.")
            return
        }
        resolve(call) {
            memoryPayload(try runtime.updateMemory(
                id: Int64(id),
                content: call.getString("content"),
                importance: call.getDouble("importance")
            ))
        }
    }

    @objc func setCoreMemory(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Memória não informada.")
            return
        }
        resolve(call) {
            memoryPayload(try runtime.setCoreMemory(id: Int64(id), enabled: call.getBool("enabled") ?? false))
        }
    }

    @objc func deleteMemory(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Memória não informada.")
            return
        }
        resolve(call) {
            try runtime.deleteMemory(id: Int64(id), force: call.getBool("force") ?? false)
            return [:]
        }
    }

    @objc func listFocusTasks(_ call: CAPPluginCall) {
        resolve(call) {
            ["tasks": try runtime.focusTasks().map(focusTaskPayload)]
        }
    }

    @objc func createFocusTask(_ call: CAPPluginCall) {
        guard let title = call.getString("title") else {
            call.reject("Título da tarefa não informado.")
            return
        }
        resolve(call) {
            focusTaskPayload(try runtime.createFocusTask(
                title: title,
                category: call.getString("category") ?? "other",
                priority: call.getString("priority") ?? "medium",
                isFocus: call.getBool("isFocus") ?? false,
                dueDate: call.getString("dueDate"),
                itemType: call.getString("itemType") ?? "TASK"
            ))
        }
    }

    @objc func updateFocusTask(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Tarefa não informada.")
            return
        }
        resolve(call) {
            focusTaskPayload(try runtime.updateFocusTask(
                id: Int64(id),
                title: call.getString("title"),
                category: call.getString("category"),
                priority: call.getString("priority"),
                completed: call.getBool("completed"),
                isFocus: call.getBool("isFocus")
            ))
        }
    }

    @objc func deleteFocusTask(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Tarefa não informada.")
            return
        }
        resolve(call) {
            try runtime.deleteFocusTask(id: Int64(id))
            return [:]
        }
    }

    @objc func analyzeFocusInput(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            call.reject("Escreva uma atualização antes de analisar.")
            return
        }
        Task {
            do {
                call.resolve(["items": try await runtime.analyzeFocusInput(text)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func focusThink(_ call: CAPPluginCall) {
        guard let query = call.getString("query")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !query.isEmpty else {
            call.reject("Pergunta do Focus não informada.")
            return
        }
        Task {
            do {
                call.resolve(["suggestion": try await runtime.focusThink(query)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func saveFocusIdea(_ call: CAPPluginCall) {
        guard let content = call.getString("content") else {
            call.reject("Ideia não informada.")
            return
        }
        resolve(call) {
            try runtime.createFocusIdea(content: content)
            return [:]
        }
    }

    @objc func saveFocusDecision(_ call: CAPPluginCall) {
        guard let content = call.getString("content") else {
            call.reject("Decisão não informada.")
            return
        }
        resolve(call) {
            try runtime.createFocusDecision(content: content)
            return [:]
        }
    }

    @objc func listFocusTimeline(_ call: CAPPluginCall) {
        resolve(call) {
            ["events": try runtime.focusTimeline().map(focusTimelinePayload)]
        }
    }

    @objc func listFocusInbox(_ call: CAPPluginCall) {
        resolve(call) {
            ["items": try runtime.focusInbox().map(focusInboxPayload)]
        }
    }

    @objc func updateFocusInbox(_ call: CAPPluginCall) {
        guard let id = call.getInt("id"), let status = call.getString("status") else {
            call.reject("Item e status da Buds Inbox são obrigatórios.")
            return
        }
        resolve(call) {
            try runtime.updateFocusInbox(id: Int64(id), status: status)
            return [:]
        }
    }

    @objc func syncFocusNotifications(_ call: CAPPluginCall) {
        let reminders: [BudsFocusTaskRecord]
        do {
            reminders = try runtime.focusTasks().filter {
                !$0.completed && $0.itemType == "REMINDER" && $0.dueDate != nil
            }
        } catch {
            call.reject(error.localizedDescription)
            return
        }

        let center = UNUserNotificationCenter.current()
        if reminders.isEmpty {
            replaceFocusNotifications([], center: center) { _ in
                call.resolve(["scheduled": 0, "authorized": false])
            }
            return
        }
        center.getNotificationSettings { settings in
            let finish: (Bool) -> Void = { authorized in
                guard authorized else {
                    call.resolve(["scheduled": 0, "authorized": false])
                    return
                }
                self.replaceFocusNotifications(reminders, center: center) { count in
                    call.resolve(["scheduled": count, "authorized": true])
                }
            }
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                finish(true)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { allowed, _ in finish(allowed) }
            default:
                finish(false)
            }
        }
    }

    @objc func startSpeechRecognition(_ call: CAPPluginCall) {
        guard let recordingId = call.getString("recordingId") else {
            call.reject("Identificador da gravação não informado.")
            return
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                try await speechRecognizer.start(operationId: recordingId, localeIdentifier: "pt-BR") { [weak self] transcript, isFinal, volume in
                    DispatchQueue.main.async {
                        self?.notifyListeners("speechRecognitionUpdate", data: [
                            "text": transcript,
                            "isFinal": isFinal,
                            "volume": volume,
                            "recordingId": recordingId,
                        ])
                    }
                }
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func stopSpeechRecognition(_ call: CAPPluginCall) {
        guard let recordingId = call.getString("recordingId") else {
            call.reject("Identificador da gravação não informado.")
            return
        }
        Task {
            let transcript = await speechRecognizer.stop(operationId: recordingId)
            call.resolve(["text": transcript, "recordingId": recordingId])
        }
    }

    @objc func cancelSpeechRecognition(_ call: CAPPluginCall) {
        let recordingId = call.getString("recordingId")
        Task {
            await speechRecognizer.cancel(operationId: recordingId)
            call.resolve()
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"),
              let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            call.reject("Mensagem e conversa são obrigatórias.")
            return
        }
        let generationId = call.getString("generationId") ?? UUID().uuidString

        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await runtime.generate(
                    generationId: generationId,
                    sessionId: sessionId,
                    text: text
                ) { [weak self] token in
                    DispatchQueue.main.async {
                        self?.notifyListeners("chatToken", data: [
                            "generationId": generationId,
                            "content": token,
                            "model": BudsModelManager.modelName,
                        ])
                    }
                }
                var payload: [String: Any] = [
                    "generationId": generationId,
                    "text": result.text,
                    "model": BudsModelManager.modelName,
                ]
                if let session = result.session {
                    payload["session"] = sessionPayload(session)
                }
                let metrics = generationMetricsPayload(result.metrics)
                payload["metrics"] = metrics
                notifyListeners("performanceMetric", data: metrics)
                call.resolve(payload)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func stopGeneration(_ call: CAPPluginCall) {
        runtime.cancelGeneration(generationId: call.getString("generationId"))
        call.resolve()
    }

    private func resolve(_ call: CAPPluginCall, work: () throws -> [String: Any]) {
        do {
            call.resolve(try work())
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    private func statusPayload(_ status: BudsRuntimeStatus) -> [String: Any] {
        [
            "databaseReady": status.databaseReady,
            "modelInstalled": status.modelInstalled,
            "modelBytes": status.modelBytes,
            "modelExpectedBytes": status.modelExpectedBytes,
            "modelRequiredBytes": status.modelRequiredBytes,
            "modelName": status.modelName,
            "thermalState": status.thermalState,
            "lowPowerMode": status.lowPowerMode,
            "storage": [
                "availableBytes": status.storage.availableBytes,
                "usedBytes": status.storage.usedBytes,
                "databaseBytes": status.storage.databaseBytes,
                "warning": status.storage.warning,
                "databaseBlocked": status.storage.databaseBlocked,
                "modelDownloadAllowed": status.storage.modelDownloadAllowed,
            ],
        ]
    }

    private func sessionPayload(_ session: BudsSessionRecord) -> [String: Any] {
        ["id": session.id, "title": session.title, "created_at": session.createdAt]
    }

    private func conversationStoragePayload(_ item: BudsConversationStorageRecord) -> [String: Any] {
        [
            "id": item.id,
            "title": item.title,
            "created_at": item.createdAt ?? NSNull(),
            "deleted_at": item.deletedAt ?? NSNull(),
            "state": item.state,
            "message_count": item.messageCount,
            "knowledge_count": 0,
            "memory_count": item.memoryCount,
            "timeline_count": 0,
            "graph_count": 0,
            "total_records": item.totalRecords,
            "estimated_bytes": item.estimatedBytes,
        ]
    }

    private func messagePayload(_ message: BudsMessageRecord) -> [String: Any] {
        [
            "id": message.id,
            "session_id": message.sessionId,
            "sender": message.sender,
            "text": message.text,
            "created_at": message.createdAt,
        ]
    }

    private func memoryPayload(_ memory: BudsMemoryRecord) -> [String: Any] {
        var payload: [String: Any] = [
            "id": memory.id,
            "content": memory.content,
            "memory_type": memory.isCore ? "long" : "medium",
            "importance": memory.importance,
            "access_count": 0,
            "tags": ["iphone", "local"],
            "is_core": memory.isCore,
            "locked": memory.isCore,
            "user_confirmed": true,
            "origin_type": "iphone_local",
            "scope": memory.scope,
            "created_at": memory.createdAt,
        ]
        if let sessionId = memory.sessionId { payload["session_id"] = sessionId }
        return payload
    }

    private func focusTaskPayload(_ task: BudsFocusTaskRecord) -> [String: Any] {
        var payload: [String: Any] = [
            "id": task.id,
            "title": task.title,
            "category": task.category,
            "priority": task.priority,
            "completed": task.completed,
            "is_focus": task.isFocus,
            "created_at": task.createdAt,
            "updated_at": task.updatedAt,
        ]
        payload["due_date"] = task.dueDate ?? NSNull()
        payload["item_type"] = task.itemType
        payload["source"] = task.source
        payload["source_session_id"] = task.sourceSessionId ?? NSNull()
        payload["source_message_id"] = task.sourceMessageId ?? NSNull()
        payload["confidence"] = task.confidence
        return payload
    }

    private func focusTimelinePayload(_ event: BudsFocusTimelineRecord) -> [String: Any] {
        [
            "id": event.id,
            "event_type": event.eventType,
            "title": event.title,
            "details": event.details,
            "created_at": event.createdAt,
        ]
    }

    private func focusInboxPayload(_ item: BudsFocusInboxRecord) -> [String: Any] {
        [
            "id": item.id,
            "item_type": item.itemType,
            "content": item.content,
            "metadata": item.metadata,
            "source": item.source,
            "status": item.status,
            "created_at": item.createdAt,
        ]
    }

    private func replaceFocusNotifications(
        _ reminders: [BudsFocusTaskRecord],
        center: UNUserNotificationCenter,
        completion: @escaping (Int) -> Void
    ) {
        center.getPendingNotificationRequests { existing in
            let oldIds = existing.map(\.identifier).filter { $0.hasPrefix("buds-focus-") }
            if !oldIds.isEmpty { center.removePendingNotificationRequests(withIdentifiers: oldIds) }

            let future = reminders.compactMap { task -> (BudsFocusTaskRecord, Date)? in
                guard let rawDate = task.dueDate, let date = Self.focusReminderDate(rawDate), date > Date() else { return nil }
                return (task, date)
            }
            guard !future.isEmpty else {
                completion(0)
                return
            }

            let group = DispatchGroup()
            let lock = NSLock()
            var scheduled = 0
            for (task, date) in future {
                let content = UNMutableNotificationContent()
                content.title = "Buds Focus"
                content.body = task.title
                content.sound = .default
                content.userInfo = ["focusTaskId": task.id]
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                let request = UNNotificationRequest(
                    identifier: "buds-focus-\(task.id)",
                    content: content,
                    trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
                )
                group.enter()
                center.add(request) { error in
                    if error == nil {
                        lock.lock(); scheduled += 1; lock.unlock()
                    }
                    group.leave()
                }
            }
            group.notify(queue: .main) { completion(scheduled) }
        }
    }

    private static func focusReminderDate(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        for format in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: value) { return date }
        }
        return ISO8601DateFormatter().date(from: value)
    }

    private func generationMetricsPayload(_ metrics: BudsGenerationMetrics) -> [String: Any] {
        [
            "stage": "llm_generation",
            "generation_id": metrics.generationId,
            "model": metrics.modelName,
            "prompt_characters": metrics.promptCharacters,
            "history_messages": metrics.historyMessages,
            "memory_items": metrics.memoryItems,
            "prompt_tokens": metrics.promptTokens,
            "output_tokens": metrics.outputTokens,
            "model_load_ms": metrics.loadMilliseconds,
            "llm_ttft_ms": metrics.timeToFirstTokenMilliseconds,
            "llm_generation_ms": metrics.generationMilliseconds,
            "total_ms": metrics.totalMilliseconds,
            "tokens_per_second": metrics.tokensPerSecond,
            "inference_threads": metrics.inferenceThreads,
            "batch_threads": metrics.batchThreads,
            "resident_bytes_before": metrics.residentBytesBefore,
            "resident_bytes_after": metrics.residentBytesAfter,
            "observed_peak_bytes": metrics.observedPeakBytes,
            "process_cpu_seconds": metrics.processCPUSeconds,
            "thermal_start": metrics.thermalStateStart,
            "thermal_end": metrics.thermalStateEnd,
        ]
    }
}
