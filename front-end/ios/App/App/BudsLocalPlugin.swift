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
        CAPPluginMethod(name: "updateSessionFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listChatFolders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createChatFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateChatFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteChatFolder", returnType: CAPPluginReturnPromise),
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
        CAPPluginMethod(name: "getLocationDashboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestCurrentLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveKnownPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteKnownPlace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLocationContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureLocationMonitoring", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocationRoutes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocationRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocationRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocationRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteLocationRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareNeuralVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enqueueNeuralSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopNeuralSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopGeneration", returnType: CAPPluginReturnPromise),
    ]

    private let runtime = BudsLocalRuntime.shared
    private let speechRecognizer = BudsSpeechRecognizer()

    public override func load() {
        super.load()
        runtime.neuralVoice.onStateChange = { [weak self] state, message in
            DispatchQueue.main.async {
                var payload: [String: Any] = ["state": state]
                if let message { payload["message"] = message }
                self?.notifyListeners("neuralSpeechState", data: payload)
            }
        }
        // Reativa somente geofences/mudanças significativas que o usuário já
        // habilitou; nunca inicia GPS preciso contínuo ao abrir o app.
        if runtime.locationMonitor.monitoringEnabled {
            try? runtime.refreshLocationRegions()
        }
        if (try? runtime.activeLocationRoute()) != nil {
            runtime.locationMonitor.startRouteTracking()
        }
    }

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
            ["sessions": try runtime.listSessions(channel: call.getString("channel") ?? "chat").map(sessionPayload)]
        }
    }

    @objc func createSession(_ call: CAPPluginCall) {
        resolve(call) {
            sessionPayload(try runtime.createSession(
                title: call.getString("title"),
                folderId: call.getString("folderId"),
                channel: call.getString("channel") ?? "chat"
            ))
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

    @objc func updateSessionFolder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Conversa não informada.")
            return
        }
        resolve(call) {
            sessionPayload(try runtime.updateSessionFolder(id: id, folderId: call.getString("folderId")))
        }
    }

    @objc func listChatFolders(_ call: CAPPluginCall) {
        resolve(call) { ["folders": try runtime.chatFolders().map(chatFolderPayload)] }
    }

    @objc func createChatFolder(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Nome da pasta não informado.")
            return
        }
        resolve(call) {
            chatFolderPayload(try runtime.createChatFolder(
                name: name,
                icon: call.getString("icon") ?? "folder",
                color: call.getString("color") ?? "#8b5cf6"
            ))
        }
    }

    @objc func updateChatFolder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Pasta não informada.")
            return
        }
        resolve(call) {
            chatFolderPayload(try runtime.updateChatFolder(
                id: id, name: call.getString("name"),
                icon: call.getString("icon"), color: call.getString("color")
            ))
        }
    }

    @objc func deleteChatFolder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Pasta não informada.")
            return
        }
        resolve(call) {
            try runtime.deleteChatFolder(id: id)
            return [:]
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
                itemType: call.getString("itemType") ?? "TASK",
                placeContext: call.getString("placeContext") ?? "anywhere",
                triggerOnArrival: call.getBool("triggerOnArrival") ?? false
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
                isFocus: call.getBool("isFocus"),
                placeContext: call.getString("placeContext"),
                triggerOnArrival: call.getBool("triggerOnArrival")
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

    @objc func getLocationDashboard(_ call: CAPPluginCall) {
        resolve(call) {
            let state = try runtime.locationState()
            return locationDashboardPayload(
                state: state,
                places: try runtime.knownPlaces(),
                events: try runtime.locationEvents(),
                monitoring: runtime.locationMonitor.monitoringEnabled,
                authorization: runtime.locationMonitor.authorizationName
            )
        }
    }

    @objc func requestCurrentLocation(_ call: CAPPluginCall) {
        Task {
            do {
                call.resolve(locationStatePayload(try await runtime.requestCurrentLocation()))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func saveKnownPlace(_ call: CAPPluginCall) {
        guard let name = call.getString("name"),
              let context = call.getString("context"),
              let latitude = call.getDouble("latitude"),
              let longitude = call.getDouble("longitude") else {
            call.reject("Nome, contexto e localização são obrigatórios.")
            return
        }
        resolve(call) {
            let place = try runtime.saveKnownPlace(
                id: call.getInt("id").map(Int64.init),
                name: name,
                context: context,
                latitude: latitude,
                longitude: longitude,
                radiusMeters: call.getDouble("radiusM") ?? 180,
                enabled: call.getBool("enabled") ?? true
            )
            try runtime.refreshLocationRegions()
            return knownPlacePayload(place)
        }
    }

    @objc func deleteKnownPlace(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Lugar não informado.")
            return
        }
        resolve(call) {
            try runtime.deleteKnownPlace(id: Int64(id))
            try runtime.refreshLocationRegions()
            return [:]
        }
    }

    @objc func setLocationContext(_ call: CAPPluginCall) {
        guard let context = call.getString("context") else {
            call.reject("Contexto não informado.")
            return
        }
        resolve(call) {
            locationStatePayload(try runtime.setSemanticLocationContext(context))
        }
    }

    @objc func configureLocationMonitoring(_ call: CAPPluginCall) {
        do {
            let result = try runtime.configureLocationMonitoring(enabled: call.getBool("enabled") ?? false)
            call.resolve(["enabled": result.enabled, "authorization": result.authorization])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func getLocationRoutes(_ call: CAPPluginCall) {
        resolve(call) {
            [
                "active": try runtime.activeLocationRoute().map(locationRoutePayload) ?? NSNull(),
                "routes": try runtime.locationRoutes(limit: call.getInt("limit") ?? 30).map(locationRoutePayload),
            ]
        }
    }

    @objc func getLocationRoute(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Trajeto não informado.")
            return
        }
        resolve(call) {
            guard let route = try runtime.locationRoute(id: Int64(id)) else {
                throw NSError(domain: "BudsLocation", code: 404, userInfo: [NSLocalizedDescriptionKey: "Trajeto não encontrado."])
            }
            return locationRoutePayload(route)
        }
    }

    @objc func startLocationRoute(_ call: CAPPluginCall) {
        resolve(call) { locationRoutePayload(try runtime.startLocationRoute(name: call.getString("name"))) }
    }

    @objc func stopLocationRoute(_ call: CAPPluginCall) {
        resolve(call) {
            ["route": try runtime.finishLocationRoute().map(locationRoutePayload) ?? NSNull()]
        }
    }

    @objc func deleteLocationRoute(_ call: CAPPluginCall) {
        guard let id = call.getInt("id") else {
            call.reject("Trajeto não informado.")
            return
        }
        resolve(call) {
            try runtime.deleteLocationRoute(id: Int64(id))
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

    @objc func prepareNeuralVoice(_ call: CAPPluginCall) {
        runtime.neuralVoice.prepare { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    call.resolve(["ready": true, "voice": "pf_dora", "language": "pt-BR"])
                case let .failure(error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func enqueueNeuralSpeech(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            call.reject("Texto da fala não informado.")
            return
        }
        runtime.neuralVoice.enqueue(text)
        call.resolve()
    }

    @objc func stopNeuralSpeech(_ call: CAPPluginCall) {
        runtime.neuralVoice.stop(releaseEngine: call.getBool("releaseEngine") ?? false)
        call.resolve()
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
        [
            "id": session.id,
            "title": session.title,
            "created_at": session.createdAt,
            "folder_id": session.folderId ?? NSNull(),
            "channel": session.channel,
        ]
    }

    private func chatFolderPayload(_ folder: BudsChatFolderRecord) -> [String: Any] {
        [
            "id": folder.id, "name": folder.name, "icon": folder.icon,
            "color": folder.color, "created_at": folder.createdAt,
            "updated_at": folder.updatedAt, "chat_count": folder.chatCount,
        ]
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
        payload["place_context"] = task.placeContext
        payload["trigger_on_arrival"] = task.triggerOnArrival
        payload["location_relevant"] = task.locationRelevant
        payload["current_location_context"] = task.currentLocationContext
        return payload
    }

    private func knownPlacePayload(_ place: BudsKnownPlaceRecord) -> [String: Any] {
        [
            "id": place.id,
            "name": place.name,
            "context": place.context,
            "latitude": place.latitude,
            "longitude": place.longitude,
            "radius_m": place.radiusMeters,
            "enabled": place.enabled,
            "created_at": place.createdAt,
            "updated_at": place.updatedAt,
        ]
    }

    private func locationStatePayload(_ state: BudsLocationStateRecord) -> [String: Any] {
        [
            "id": 1,
            "place_id": state.placeId ?? NSNull(),
            "place_name": state.placeName ?? NSNull(),
            "context": state.context,
            "status": state.status,
            "latitude": state.latitude ?? NSNull(),
            "longitude": state.longitude ?? NSNull(),
            "accuracy_m": state.accuracyMeters ?? NSNull(),
            "source": state.source,
            "updated_at": state.updatedAt ?? NSNull(),
            "changed": state.changed,
        ]
    }

    private func locationEventPayload(_ event: BudsLocationEventRecord) -> [String: Any] {
        [
            "id": event.id,
            "place_id": event.placeId ?? NSNull(),
            "place_name": event.placeName ?? NSNull(),
            "event_type": event.eventType,
            "context": event.context,
            "source": event.source,
            "created_at": event.createdAt,
        ]
    }

    private func locationRoutePointPayload(_ point: BudsLocationRoutePointRecord) -> [String: Any] {
        [
            "id": point.id,
            "route_id": point.routeId,
            "latitude": point.latitude,
            "longitude": point.longitude,
            "accuracy_m": point.accuracyMeters ?? NSNull(),
            "altitude_m": point.altitudeMeters ?? NSNull(),
            "speed_mps": point.speedMetersPerSecond ?? NSNull(),
            "recorded_at": point.recordedAt,
        ]
    }

    private func locationRoutePayload(_ route: BudsLocationRouteRecord) -> [String: Any] {
        [
            "id": route.id,
            "name": route.name,
            "status": route.status,
            "started_at": route.startedAt,
            "ended_at": route.endedAt ?? NSNull(),
            "distance_m": route.distanceMeters,
            "duration_s": route.durationSeconds,
            "point_count": route.pointCount,
            "created_at": route.createdAt,
            "points": route.points.map(locationRoutePointPayload),
        ]
    }

    private func locationDashboardPayload(
        state: BudsLocationStateRecord,
        places: [BudsKnownPlaceRecord],
        events: [BudsLocationEventRecord],
        monitoring: Bool,
        authorization: String
    ) -> [String: Any] {
        [
            "state": locationStatePayload(state),
            "places": places.map(knownPlacePayload),
            "events": events.map(locationEventPayload),
            "monitoring": [
                "enabled": monitoring,
                "authorization": authorization,
                "mode": "significant_changes_and_geofences",
            ],
            "policy": [
                "continuous_gps": false,
                "precise_only_on_demand": true,
                "coordinates_sent_to_model": false,
            ],
        ]
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
