import CryptoKit
import Foundation

public final class BudsModelManager: @unchecked Sendable {
    public static let modelName = "qwen2.5-coder:7b"
    public static let fileName = "qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    public static let expectedSHA256 = "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c"
    public static let macOllamaSHA256 = "60e05f2100071479f596b964f89f510f057ce397ea22f2833a0cfe029bfc2463"
    public static let macOllamaBytes: Int64 = 4_683_074_048
    public static let downloadURL = URL(string:
        "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    )!

    public let modelURL: URL
    private let markerURL: URL
    private let lock = NSLock()
    private var activeDownloader: BudsModelDownloader?

    public init() throws {
        Self.cleanupOrphanedSystemDownloads()
        let modelDirectory = try BudsStorageGuard.appSupportDirectory()
            .appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = modelDirectory
        try? mutableDirectory.setResourceValues(values)
        modelURL = modelDirectory.appendingPathComponent(Self.fileName)
        markerURL = modelDirectory.appendingPathComponent("\(Self.fileName).sha256")

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
        let attributes = try? FileManager.default.attributesOfItem(atPath: modelURL.path)
        return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    }

    public var isInstalled: Bool {
        let acceptedHash: String
        switch installedBytes {
        case BudsStorageGuard.modelBytes:
            acceptedHash = Self.expectedSHA256
        case Self.macOllamaBytes:
            acceptedHash = Self.macOllamaSHA256
        default:
            return false
        }
        guard let marker = try? String(contentsOf: markerURL, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
        return marker == acceptedHash
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
            guard size == BudsStorageGuard.modelBytes else {
                throw BudsNativeError.modelIntegrity
            }
            let digest = try sha256(of: temporaryURL)
            guard digest == Self.expectedSHA256 else {
                throw BudsNativeError.modelIntegrity
            }
            if FileManager.default.fileExists(atPath: modelURL.path) {
                try FileManager.default.removeItem(at: modelURL)
            }
            try FileManager.default.moveItem(at: temporaryURL, to: modelURL)
            try Self.expectedSHA256.write(to: markerURL, atomically: true, encoding: .utf8)
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
        let temporaryURL = modelURL.deletingLastPathComponent()
            .appendingPathComponent("\(Self.fileName).download")
        for url in [modelURL, markerURL, temporaryURL] where FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private func removeIncompleteModel() throws {
        if FileManager.default.fileExists(atPath: modelURL.path), !isInstalled {
            try FileManager.default.removeItem(at: modelURL)
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
