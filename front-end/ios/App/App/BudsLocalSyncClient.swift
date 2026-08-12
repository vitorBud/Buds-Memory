import BudsNativeRuntime
import Foundation
import Security
import UIKit

struct BudsDiscoveredSyncPeer {
    let deviceId: String
    let deviceName: String
    let deviceType: String
    let baseURL: String
    let protocolVersion: Int
}

struct BudsLocalSyncRunResult {
    let sent: Int
    let received: Int
    let changed: Int
    let conflicts: Int
    let discoveryMs: Double
    let connectMs: Double
    let manifestMs: Double
    let transferMs: Double
    let applyMs: Double
    let totalMs: Double
}

enum BudsLocalSyncClientError: LocalizedError {
    case invalidResponse
    case peerNotTrusted
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "O Mac respondeu com um pacote Local Sync inválido."
        case .peerNotTrusted: return "Este Mac ainda não foi pareado com o iPhone."
        case .server(let message): return message
        }
    }
}

final class BudsLocalSyncClient: @unchecked Sendable {
    static let protocolVersion = 1
    static let appVersion = "1"
    static let capabilities = [
        "focus_tasks", "presence", "manual_sync_request",
    ]
    static let shared = BudsLocalSyncClient()
    private let runtime = BudsLocalRuntime.shared
    private var activeDiscovery: BudsBonjourDiscovery?
    private var presenceTimer: Timer?
    private var connectedPeerIds: Set<String> = []
    private let connectedPeersLock = NSLock()
    private(set) var lastDiscoveryMs = 0.0

    private init() {}

    func isConnected(peerDeviceId: String) -> Bool {
        connectedPeersLock.lock()
        defer { connectedPeersLock.unlock() }
        return connectedPeerIds.contains(peerDeviceId)
    }

    private func setConnected(_ connected: Bool, peerDeviceId: String) {
        connectedPeersLock.lock()
        if connected { connectedPeerIds.insert(peerDeviceId) }
        else { connectedPeerIds.remove(peerDeviceId) }
        connectedPeersLock.unlock()
    }

    func discover(timeout: TimeInterval = 3.0) async throws -> [BudsDiscoveredSyncPeer] {
        let started = CFAbsoluteTimeGetCurrent()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                let discovery = BudsBonjourDiscovery()
                self.activeDiscovery = discovery
                discovery.start(timeout: timeout) { result in
                    self.lastDiscoveryMs = (CFAbsoluteTimeGetCurrent() - started) * 1_000
                    self.activeDiscovery = nil
                    continuation.resume(with: result)
                }
            }
        }
    }

    func pair(peer: BudsDiscoveredSyncPeer, code: String) async throws -> BudsLocalSyncPeerStateRecord {
        let device = try runtime.localSyncDevice()
        let body: [String: Any] = [
            "code": code,
            "device": [
                "device_id": device.deviceId,
                "device_name": device.deviceName,
                "device_type": device.deviceType,
                "protocol_version": Self.protocolVersion,
                "app_version": Self.appVersion,
                "capabilities": Self.capabilities,
            ],
        ]
        let payload = try await requestJSON(
            url: peer.baseURL + "/api/local-sync/v1/pairing/complete",
            body: body,
            headers: [:]
        )
        guard let token = payload["token"] as? String,
              let server = payload["server_device"] as? [String: Any],
              let serverId = server["device_id"] as? String,
              serverId == peer.deviceId,
              int64(payload["protocol_version"]) == Int64(Self.protocolVersion) else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        try BudsSyncKeychain.save(token: token, peerDeviceId: serverId)
        return try runtime.trustLocalSyncPeer(
            peerDeviceId: serverId,
            peerName: server["device_name"] as? String ?? peer.deviceName,
            peerType: server["device_type"] as? String ?? peer.deviceType,
            baseURL: peer.baseURL,
            protocolVersion: Self.protocolVersion,
            appVersion: payload["app_version"] as? String,
            capabilities: payload["capabilities"] as? [String] ?? []
        )
    }

    func sync(peer: BudsLocalSyncPeerStateRecord) async throws -> BudsLocalSyncRunResult {
        guard peer.trusted,
              let token = BudsSyncKeychain.token(peerDeviceId: peer.peerDeviceId) else {
            throw BudsLocalSyncClientError.peerNotTrusted
        }
        let started = CFAbsoluteTimeGetCurrent()
        // A credencial nunca é enviada para uma URL recém-anunciada por
        // Bonjour. Ela fica vinculada ao endereço confirmado no pareamento;
        // se o IP mudar, o usuário refaz o pareamento nesta V0.
        let baseURL = peer.baseURL
        let pending = try runtime.pendingLocalSyncFocusChanges(peerDeviceId: peer.peerDeviceId)
        let outgoing = pending.map { change -> [String: Any] in
            [
                "client_seq": change.localSeq,
                "change_id": change.changeId,
                "task": taskDictionary(change.task),
            ]
        }
        let headers = [
            "Authorization": "Bearer \(token)",
            "X-Buds-Sync-Device": try runtime.localSyncDevice().deviceId,
        ]
        let manifestStarted = CFAbsoluteTimeGetCurrent()
        let manifest = try await requestJSON(
            url: baseURL + "/api/local-sync/v1/manifest",
            body: [
                "protocol_version": Self.protocolVersion,
                "schema_version": 1,
                "server_cursor": peer.lastRemoteSeq,
                "pending": ["focus_tasks": outgoing.count],
            ],
            headers: headers
        )
        guard int64(manifest["protocol_version"]) == Int64(Self.protocolVersion),
              int64(manifest["schema_version"]) == 1,
              manifest["plan"] is [String: Any] else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        let manifestMs = (CFAbsoluteTimeGetCurrent() - manifestStarted) * 1_000
        let requestStarted = CFAbsoluteTimeGetCurrent()
        let response: [String: Any]
        do {
            response = try await requestJSON(
                url: baseURL + "/api/local-sync/v1/focus/exchange",
                body: [
                    "protocol_version": Self.protocolVersion,
                    "schema_version": 1,
                    "server_cursor": peer.lastRemoteSeq,
                    "acknowledged_client_seq": peer.lastAcknowledgedSeq,
                    "changes": outgoing,
                ],
                headers: headers
            )
        } catch {
            try? runtime.recordLocalSyncError(peerDeviceId: peer.peerDeviceId, message: error.localizedDescription)
            throw error
        }
        let requestMs = (CFAbsoluteTimeGetCurrent() - requestStarted) * 1_000
        guard let exchangeId = response["exchange_id"] as? String,
              let serverCursor = int64(response["server_cursor"]),
              let ackClientSeq = int64(response["ack_client_seq"]),
              let rawChanges = response["changes"] as? [[String: Any]] else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        let remoteChanges = try rawChanges.map(parseRemoteChange)
        let applyStarted = CFAbsoluteTimeGetCurrent()
        let applied = try runtime.applyLocalSyncFocusExchange(
            peerDeviceId: peer.peerDeviceId,
            baseURL: baseURL,
            remoteChanges: remoteChanges,
            serverCursor: serverCursor,
            acknowledgedClientSeq: ackClientSeq,
            sentCount: outgoing.count
        )
        let localApplyMs = (CFAbsoluteTimeGetCurrent() - applyStarted) * 1_000
        let ack: [String: Any]
        do {
            ack = try await requestJSON(
                url: baseURL + "/api/local-sync/v1/ack",
                body: [
                    "protocol_version": Self.protocolVersion,
                    "schema_version": 1,
                    "exchange_id": exchangeId,
                    "server_cursor": serverCursor,
                    "applied": remoteChanges.count,
                ],
                headers: headers
            )
        } catch {
            try? runtime.recordLocalSyncError(peerDeviceId: peer.peerDeviceId, message: error.localizedDescription)
            throw error
        }
        guard ack["acknowledged"] as? Bool == true else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        let serverMetrics = response["metrics"] as? [String: Any] ?? [:]
        let serverApplyMs = double(serverMetrics["apply_ms"])
        let totalMs = (CFAbsoluteTimeGetCurrent() - started) * 1_000
        let transferMs = max(0, requestMs - manifestMs - serverApplyMs)
        try runtime.recordLocalSyncSuccess(
            peerDeviceId: peer.peerDeviceId, sentCount: outgoing.count,
            receivedCount: remoteChanges.count, durationMs: totalMs
        )
        return BudsLocalSyncRunResult(
            sent: outgoing.count,
            received: remoteChanges.count,
            changed: applied.changed,
            conflicts: applied.conflicts,
            discoveryMs: lastDiscoveryMs,
            connectMs: requestMs,
            manifestMs: manifestMs,
            transferMs: transferMs,
            applyMs: localApplyMs + serverApplyMs,
            totalMs: totalMs
        )
    }

    func removeTrust(peerDeviceId: String) {
        BudsSyncKeychain.remove(peerDeviceId: peerDeviceId)
    }

    func removeAllTrust() {
        BudsSyncKeychain.removeAll()
    }

    func startPresenceLoop(onUpdate: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.presenceTimer?.invalidate()
            self.presenceTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.runPresenceCycle(onUpdate: onUpdate) }
            }
            Task { @MainActor in await self.runPresenceCycle(onUpdate: onUpdate) }
        }
    }

    @MainActor
    private func runPresenceCycle(onUpdate: @escaping ([String: Any]) -> Void) async {
        guard UIApplication.shared.applicationState == .active,
              let peers = try? runtime.localSyncPeers() else { return }
        for peer in peers where peer.trusted {
            guard let token = BudsSyncKeychain.token(peerDeviceId: peer.peerDeviceId) else { continue }
            do {
                let response = try await requestJSON(
                    url: peer.baseURL + "/api/local-sync/v1/presence",
                    body: [
                        "protocol_version": Self.protocolVersion,
                        "app_version": Self.appVersion,
                        "capabilities": Self.capabilities,
                    ],
                    headers: [
                        "Authorization": "Bearer \(token)",
                        "X-Buds-Sync-Device": try runtime.localSyncDevice().deviceId,
                    ]
                )
                setConnected(true, peerDeviceId: peer.peerDeviceId)
                onUpdate(["peer_device_id": peer.peerDeviceId, "connected": true])
                if response["sync_requested"] as? Bool == true {
                    let result = try await sync(peer: peer)
                    onUpdate([
                        "peer_device_id": peer.peerDeviceId, "connected": true, "synced": true,
                        "sent": result.sent, "received": result.received,
                    ])
                }
            } catch {
                setConnected(false, peerDeviceId: peer.peerDeviceId)
                onUpdate(["peer_device_id": peer.peerDeviceId, "connected": false, "error": error.localizedDescription])
            }
        }
    }

    private func requestJSON(
        url: String,
        body: [String: Any],
        headers: [String: String]
    ) async throws -> [String: Any] {
        guard let endpoint = URL(string: url) else { throw BudsLocalSyncClientError.invalidResponse }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        if !(200..<300).contains(http.statusCode) {
            throw BudsLocalSyncClientError.server(json["error"] as? String ?? "O Mac recusou o Local Sync.")
        }
        return json
    }

    private func taskDictionary(_ task: BudsSyncFocusTaskRecord) -> [String: Any] {
        var value: [String: Any] = [
            "sync_uid": task.syncUid, "title": task.title, "category": task.category,
            "priority": task.priority, "completed": task.completed, "is_focus": task.isFocus,
            "created_at": task.createdAt, "updated_at": task.updatedAt,
            "item_type": task.itemType, "source": task.source, "confidence": task.confidence,
            "place_context": task.placeContext, "trigger_on_arrival": task.triggerOnArrival,
            "sync_version": task.syncVersion,
            "sync_origin_device_id": task.syncOriginDeviceId,
            "sync_modified_at": task.syncModifiedAt,
        ]
        value["due_date"] = task.dueDate ?? NSNull()
        value["deleted_at"] = task.deletedAt ?? NSNull()
        return value
    }

    private func parseRemoteChange(_ raw: [String: Any]) throws -> BudsLocalSyncChangeRecord {
        guard let changeId = raw["change_id"] as? String,
              let task = raw["task"] as? [String: Any],
              let parsed = parseTask(task) else {
            throw BudsLocalSyncClientError.invalidResponse
        }
        return BudsLocalSyncChangeRecord(
            localSeq: int64(raw["server_seq"]) ?? 0,
            changeId: changeId,
            task: parsed
        )
    }

    private func parseTask(_ raw: [String: Any]) -> BudsSyncFocusTaskRecord? {
        guard let uid = raw["sync_uid"] as? String,
              let title = raw["title"] as? String,
              let origin = raw["sync_origin_device_id"] as? String,
              let modified = raw["sync_modified_at"] as? String,
              let version = int64(raw["sync_version"]) else { return nil }
        return BudsSyncFocusTaskRecord(
            syncUid: uid, title: title,
            category: raw["category"] as? String ?? "other",
            priority: raw["priority"] as? String ?? "medium",
            completed: raw["completed"] as? Bool ?? false,
            isFocus: raw["is_focus"] as? Bool ?? false,
            createdAt: raw["created_at"] as? String ?? modified,
            updatedAt: raw["updated_at"] as? String ?? modified,
            dueDate: raw["due_date"] as? String,
            itemType: raw["item_type"] as? String ?? "TASK",
            source: raw["source"] as? String ?? "manual",
            confidence: double(raw["confidence"]),
            placeContext: raw["place_context"] as? String ?? "anywhere",
            triggerOnArrival: raw["trigger_on_arrival"] as? Bool ?? false,
            syncVersion: version,
            syncOriginDeviceId: origin,
            syncModifiedAt: modified,
            deletedAt: raw["deleted_at"] as? String
        )
    }

    private func int64(_ value: Any?) -> Int64? {
        if let value = value as? Int64 { return value }
        if let value = value as? Int { return Int64(value) }
        if let value = value as? NSNumber { return value.int64Value }
        return nil
    }

    private func double(_ value: Any?) -> Double {
        if let value = value as? Double { return value }
        if let value = value as? NSNumber { return value.doubleValue }
        return 0
    }
}

private final class BudsBonjourDiscovery: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var peers: [String: BudsDiscoveredSyncPeer] = [:]
    private var completion: ((Result<[BudsDiscoveredSyncPeer], Error>) -> Void)?
    private var timer: Timer?

    func start(timeout: TimeInterval, completion: @escaping (Result<[BudsDiscoveredSyncPeer], Error>) -> Void) {
        self.completion = completion
        browser.delegate = self
        browser.searchForServices(ofType: "_budssync._tcp.", inDomain: "local.")
        timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in self?.finish() }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 2)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let data = sender.txtRecordData() else { return }
        let values = NetService.dictionary(fromTXTRecord: data)
        func string(_ key: String) -> String? {
            values[key].flatMap { String(data: $0, encoding: .utf8) }
        }
        guard string("protocol") == "buds-local-sync",
              string("version") == "1",
              let id = string("id"), let url = string("url") else { return }
        peers[id] = BudsDiscoveredSyncPeer(
            deviceId: id,
            deviceName: sender.name.replacingOccurrences(of: "Buds Memory — ", with: ""),
            deviceType: string("type") ?? "mac",
            baseURL: url,
            protocolVersion: Int(string("version") ?? "0") ?? 0
        )
    }

    private func finish() {
        browser.stop()
        services.forEach { $0.stop() }
        timer?.invalidate()
        timer = nil
        let result = peers.values.sorted { $0.deviceName.localizedCaseInsensitiveCompare($1.deviceName) == .orderedAscending }
        completion?(.success(result))
        completion = nil
    }
}

private enum BudsSyncKeychain {
    private static let service = "com.budsmemory.local-sync.v0"

    static func save(token: String, peerDeviceId: String) throws {
        remove(peerDeviceId: peerDeviceId)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peerDeviceId,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(token.utf8),
        ]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else {
            throw BudsLocalSyncClientError.server("Não foi possível proteger a credencial do Mac no Chaves do iPhone.")
        }
    }

    static func token(peerDeviceId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peerDeviceId,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(peerDeviceId: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peerDeviceId,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func removeAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
