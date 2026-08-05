import Foundation

public enum BudsStorageGuard {
    public static let warningBytes: Int64 = 3 * 1_073_741_824
    public static let databaseMinimumBytes: Int64 = 1_500_000_000
    public static let modelBytes: Int64 = 2_104_932_800 // Qwen 2.5 Coder 3B
    public static let modelSafetyMarginBytes: Int64 = 2 * 1_073_741_824
    public static let modelRequiredBytes = modelBytes + modelSafetyMarginBytes

    public static func appSupportDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("BudsMemory", isDirectory: true)
        let legacyDirectory = base.appendingPathComponent("AetherMemory", isDirectory: true)
        try migrateLegacyDirectory(from: legacyDirectory, to: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func migrateLegacyDirectory(from legacy: URL, to current: URL) throws {
        let manager = FileManager.default
        guard manager.fileExists(atPath: legacy.path) else { return }

        if !manager.fileExists(atPath: current.path) {
            try manager.moveItem(at: legacy, to: current)
            return
        }

        // Se uma versão anterior já criou a pasta nova vazia, combina os itens
        // sem copiar o modelo de vários GB nem substituir dados atuais.
        let legacyItems = try manager.contentsOfDirectory(
            at: legacy,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        for source in legacyItems {
            let destination = current.appendingPathComponent(source.lastPathComponent)
            if !manager.fileExists(atPath: destination.path) {
                try manager.moveItem(at: source, to: destination)
            }
        }
        if (try? manager.contentsOfDirectory(atPath: legacy.path).isEmpty) == true {
            try? manager.removeItem(at: legacy)
        }
    }

    public static func availableBytes() -> Int64 {
        do {
            let root = try appSupportDirectory()
            let values = try root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            return values.volumeAvailableCapacityForImportantUsage ?? 0
        } catch {
            return 0
        }
    }

    public static func status() -> BudsStorageStatus {
        let available = availableBytes()
        let sizes = ownedStorageBytes()
        return BudsStorageStatus(
            availableBytes: available,
            usedBytes: sizes.total,
            databaseBytes: sizes.database,
            warning: available < warningBytes,
            databaseBlocked: available < databaseMinimumBytes,
            modelDownloadAllowed: available >= modelRequiredBytes
        )
    }

    private static func ownedStorageBytes() -> (total: Int64, database: Int64) {
        guard let root = try? appSupportDirectory() else { return (0, 0) }
        let manager = FileManager.default
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey]
        guard let files = manager.enumerator(
            at: root,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsPackageDescendants]
        ) else { return (0, 0) }

        var total: Int64 = 0
        var database: Int64 = 0
        let databaseNames: Set<String> = [
            "buds-memory-iphone.sqlite3",
            "buds-memory-iphone.sqlite3-wal",
            "buds-memory-iphone.sqlite3-shm",
            "aether-memory-iphone.sqlite3",
            "aether-memory-iphone.sqlite3-wal",
            "aether-memory-iphone.sqlite3-shm",
        ]
        for case let file as URL in files {
            guard let values = try? file.resourceValues(forKeys: keys),
                  values.isRegularFile == true else { continue }
            let bytes = Int64(values.fileSize ?? 0)
            total += bytes
            if databaseNames.contains(file.lastPathComponent) {
                database += bytes
            }
        }
        return (total, database)
    }

    public static func requireDatabaseSpace() throws {
        let available = availableBytes()
        guard available >= databaseMinimumBytes else {
            throw BudsNativeError.insufficientStorage(
                available: available,
                required: databaseMinimumBytes
            )
        }
    }

    public static func requireModelDownloadSpace() throws {
        let available = availableBytes()
        guard available >= modelRequiredBytes else {
            throw BudsNativeError.insufficientStorage(
                available: available,
                required: modelRequiredBytes
            )
        }
    }
}
