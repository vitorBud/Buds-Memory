import Foundation

public enum AetherStorageGuard {
    public static let warningBytes: Int64 = 3 * 1_073_741_824
    public static let databaseMinimumBytes: Int64 = 1_500_000_000
    public static let modelBytes: Int64 = 4_683_073_536
    public static let modelSafetyMarginBytes: Int64 = 2 * 1_073_741_824
    public static let modelRequiredBytes = modelBytes + modelSafetyMarginBytes

    public static func appSupportDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent("AetherMemory", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
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

    public static func status() -> AetherStorageStatus {
        let available = availableBytes()
        let sizes = ownedStorageBytes()
        return AetherStorageStatus(
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
            throw AetherNativeError.insufficientStorage(
                available: available,
                required: databaseMinimumBytes
            )
        }
    }

    public static func requireModelDownloadSpace() throws {
        let available = availableBytes()
        guard available >= modelRequiredBytes else {
            throw AetherNativeError.insufficientStorage(
                available: available,
                required: modelRequiredBytes
            )
        }
    }
}
