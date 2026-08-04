import BudsNativeRuntime
import Capacitor
import Foundation

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
