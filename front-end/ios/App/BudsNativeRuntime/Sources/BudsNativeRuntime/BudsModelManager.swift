import CryptoKit
import Foundation

public final class BudsModelManager: @unchecked Sendable {
    public static let modelName = "qwen2.5-coder:3b"
    public static let fileName = "qwen2.5-coder-3b-instruct-q4_k_m.gguf"
    public static let downloadURL = URL(string:
        "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf"
    )!

    public var modelURL: URL {
        if let bundleURL = Bundle.main.url(forResource: "qwen2.5-coder-3b-instruct-q4_k_m", withExtension: "gguf") {
            return bundleURL
        }
        return persistentModelURL
    }
    
    private let persistentModelURL: URL
    private let markerURL: URL

    public init() throws {
        Self.cleanupOrphanedSystemDownloads()
        let modelDirectory = try BudsStorageGuard.appSupportDirectory()
            .appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = modelDirectory
        try? mutableDirectory.setResourceValues(values)
        persistentModelURL = modelDirectory.appendingPathComponent(Self.fileName)
        markerURL = modelDirectory.appendingPathComponent("\(Self.fileName).installed")

        // Um download interrompido podia ficar ocupando vários GB mesmo depois
        // de reabrir o app. No início não existe download ativo, então o arquivo
        // parcial é sempre órfão e pode ser removido sem tocar no modelo válido.
        let orphanedDownload = modelDirectory.appendingPathComponent("\(Self.fileName).download")
        if FileManager.default.fileExists(atPath: orphanedDownload.path) {
            try? FileManager.default.removeItem(at: orphanedDownload)
        }
    }

    private static func cleanupOrphanedSystemDownloads() {
        let manager = FileManager.default
        let temporaryDirectory = manager.temporaryDirectory
        guard let entries = try? manager.contentsOfDirectory(
            at: temporaryDirectory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        for entry in entries where entry.lastPathComponent.hasPrefix("CFNetworkDownload_")
            && entry.pathExtension == "tmp" {
            // Esses arquivos só sobrevivem quando uma URLSession anterior foi
            // interrompida. Em uma nova inicialização não pertencem a uma tarefa ativa.
            try? manager.removeItem(at: entry)
        }
    }

    public var installedBytes: Int64 {
        if Bundle.main.url(forResource: "qwen2.5-coder-3b-instruct-q4_k_m", withExtension: "gguf") != nil {
            return BudsStorageGuard.modelBytes
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: persistentModelURL.path)
        return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    }

    public var isInstalled: Bool {
        if Bundle.main.url(forResource: "qwen2.5-coder-3b-instruct-q4_k_m", withExtension: "gguf") != nil {
            return true
        }
        // Validação flexível: Qualquer download concluído que chegue perto ou ultrapasse o tamanho esperado
        return installedBytes >= (BudsStorageGuard.modelBytes - 10_000_000) &&
               FileManager.default.fileExists(atPath: markerURL.path)
    }

    public func download(progress: @escaping @Sendable (Double) -> Void) async throws {
        if isInstalled {
            progress(1)
            return
        }
        try BudsStorageGuard.requireModelDownloadSpace()
        try removeIncompleteModel()

        let temporaryURL = modelURL.deletingLastPathComponent()
            .appendingPathComponent("\(Self.fileName).download")
        let downloader = BudsModelDownloader(
            source: Self.downloadURL,
            destination: temporaryURL,
            progress: progress
        )
        lock.lock()
        activeDownloader = downloader
        lock.unlock()

        do {
            try await downloader.start()
            let size = ((try FileManager.default.attributesOfItem(atPath: temporaryURL.path)[.size]) as? NSNumber)?.int64Value ?? 0
            guard size >= (BudsStorageGuard.modelBytes - 10_000_000) else {
                throw BudsNativeError.modelIntegrity
            }
            if FileManager.default.fileExists(atPath: persistentModelURL.path) {
                try FileManager.default.removeItem(at: persistentModelURL)
            }
            try FileManager.default.moveItem(at: temporaryURL, to: persistentModelURL)
            try "installed".write(to: markerURL, atomically: true, encoding: .utf8)
            progress(1)
        } catch {
            try? FileManager.default.removeItem(at: temporaryURL)
            throw error
        }

        lock.lock()
        activeDownloader = nil
        lock.unlock()
    }

    public func cancelDownload() {
        lock.lock()
        let downloader = activeDownloader
        lock.unlock()
        downloader?.cancel()
    }

    public func removeInstalledModel() throws {
        cancelDownload()
        let temporaryURL = persistentModelURL.deletingLastPathComponent()
            .appendingPathComponent("\(Self.fileName).download")
        for url in [persistentModelURL, markerURL, temporaryURL] where FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private func removeIncompleteModel() throws {
        if FileManager.default.fileExists(atPath: persistentModelURL.path), !isInstalled {
            try FileManager.default.removeItem(at: persistentModelURL)
        }
        try? FileManager.default.removeItem(at: markerURL)
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while autoreleasepool(invoking: {
            guard let data = try? handle.read(upToCount: 8 * 1_024 * 1_024), !data.isEmpty else {
                return false
            }
            hasher.update(data: data)
            return true
        }) {}
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

private final class BudsModelDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let source: URL
    private let destination: URL
    private let progress: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var session: URLSession?
    private var task: URLSessionDownloadTask?
    private var lastProgressNotification = 0.0

    init(source: URL, destination: URL, progress: @escaping @Sendable (Double) -> Void) {
        self.source = source
        self.destination = destination
        self.progress = progress
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 120
            configuration.timeoutIntervalForResource = 60 * 60 * 8
            configuration.waitsForConnectivity = true
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            let task = session.downloadTask(with: source)
            self.task = task
            task.resume()
        }
    }

    func cancel() {
        task?.cancel()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let expected = totalBytesExpectedToWrite > 0
            ? totalBytesExpectedToWrite
            : BudsStorageGuard.modelBytes
        let value = min(1, max(0, Double(totalBytesWritten) / Double(expected)))
        let now = Date.timeIntervalSinceReferenceDate
        guard value >= 1 || now - lastProgressNotification >= 0.2 else { return }
        lastProgressNotification = now
        progress(value)
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            finish(.failure(error))
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error {
            finish(.failure(BudsNativeError.modelDownload(error.localizedDescription)))
        } else if FileManager.default.fileExists(atPath: destination.path) {
            finish(.success(()))
        } else {
            finish(.failure(BudsNativeError.modelDownload("arquivo temporário não encontrado")))
        }
    }

    private func finish(_ result: Result<Void, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        session?.finishTasksAndInvalidate()
        self.session = nil
        self.task = nil
        continuation.resume(with: result)
    }
}
