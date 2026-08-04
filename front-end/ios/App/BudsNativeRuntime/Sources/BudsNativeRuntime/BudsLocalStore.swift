import Foundation
import SQLite3

public final class BudsLocalStore: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.budsmemory.ios.sqlite")
    private var database: OpaquePointer?
    private let databaseURL: URL

    public init() throws {
        try BudsStorageGuard.requireDatabaseSpace()
        let supportDirectory = try BudsStorageGuard.appSupportDirectory()
        try Self.migrateLegacyDatabase(in: supportDirectory)
        databaseURL = supportDirectory.appendingPathComponent("buds-memory-iphone.sqlite3")
        try open()
    }

    private static func migrateLegacyDatabase(in directory: URL) throws {
        let manager = FileManager.default
        let currentName = "buds-memory-iphone.sqlite3"
        let legacyName = "aether-memory-iphone.sqlite3"
        guard !manager.fileExists(atPath: directory.appendingPathComponent(currentName).path) else { return }

        for suffix in ["", "-wal", "-shm"] {
            let source = directory.appendingPathComponent(legacyName + suffix)
            let destination = directory.appendingPathComponent(currentName + suffix)
            if manager.fileExists(atPath: source.path) {
                try manager.moveItem(at: source, to: destination)
            }
        }
    }

    deinit {
        if let database {
            sqlite3_close_v2(database)
        }
    }

    public func listSessions() throws -> [BudsSessionRecord] {
        try queue.sync {
            let sql = "SELECT id, title, created_at FROM sessions ORDER BY created_at DESC"
            let statement = try prepare(sql)
            defer { sqlite3_finalize(statement) }
            var records: [BudsSessionRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsSessionRecord(
                    id: text(statement, 0),
                    title: text(statement, 1),
                    createdAt: text(statement, 2)
                ))
            }
            return records
        }
    }

    public func getSession(id: String) throws -> BudsSessionRecord? {
        try queue.sync { try session(id: id) }
    }

    public func createSession(title: String?) throws -> BudsSessionRecord {
        try queue.sync {
            try ensureWritable()
            let record = BudsSessionRecord(
                id: UUID().uuidString.lowercased(),
                title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Nova conversa",
                createdAt: Self.now()
            )
            let statement = try prepare("INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)")
            defer { sqlite3_finalize(statement) }
            bind(record.id, statement, 1)
            bind(record.title, statement, 2)
            bind(record.createdAt, statement, 3)
            try stepDone(statement)
            return record
        }
    }

    public func updateSessionTitle(id: String, title: String) throws -> BudsSessionRecord {
        try queue.sync {
            try ensureWritable()
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            let statement = try prepare("UPDATE sessions SET title = ? WHERE id = ?")
            defer { sqlite3_finalize(statement) }
            bind(cleanTitle.nonEmpty ?? "Nova conversa", statement, 1)
            bind(id, statement, 2)
            try stepDone(statement)
            guard let record = try session(id: id) else {
                throw BudsNativeError.databaseUnavailable("Conversa não encontrada.")
            }
            return record
        }
    }

    public func deleteSession(id: String) throws {
        try queue.sync {
            try ensureWritable()
            try transaction {
                let memoryStatement = try prepare(
                    "DELETE FROM memories WHERE session_id = ? AND scope = 'conversation'"
                )
                bind(id, memoryStatement, 1)
                try stepDone(memoryStatement)
                sqlite3_finalize(memoryStatement)

                let messageStatement = try prepare("DELETE FROM messages WHERE session_id = ?")
                bind(id, messageStatement, 1)
                try stepDone(messageStatement)
                sqlite3_finalize(messageStatement)

                let sessionStatement = try prepare("DELETE FROM sessions WHERE id = ?")
                bind(id, sessionStatement, 1)
                try stepDone(sessionStatement)
                sqlite3_finalize(sessionStatement)
            }
        }
    }

    public func clearAllData() throws {
        try queue.sync {
            try transaction {
                try execute("DELETE FROM messages")
                try execute("DELETE FROM memories")
                try execute("DELETE FROM sessions")
                try execute("DELETE FROM sqlite_sequence WHERE name IN ('messages', 'memories')")
            }
            try? execute("PRAGMA wal_checkpoint(TRUNCATE)")
            try? execute("VACUUM")
        }
    }

    public func messages(sessionId: String, limit: Int = 200) throws -> [BudsMessageRecord] {
        try queue.sync {
            let sql = """
                SELECT id, session_id, sender, text, created_at
                FROM messages WHERE session_id = ?
                ORDER BY id DESC LIMIT ?
                """
            let statement = try prepare(sql)
            defer { sqlite3_finalize(statement) }
            bind(sessionId, statement, 1)
            sqlite3_bind_int(statement, 2, Int32(max(1, min(limit, 500))))
            var records: [BudsMessageRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsMessageRecord(
                    id: sqlite3_column_int64(statement, 0),
                    sessionId: text(statement, 1),
                    sender: text(statement, 2),
                    text: text(statement, 3),
                    createdAt: text(statement, 4)
                ))
            }
            return records.reversed()
        }
    }

    @discardableResult
    public func addMessage(sessionId: String, sender: String, text: String) throws -> BudsMessageRecord {
        try queue.sync {
            try ensureWritable()
            let createdAt = Self.now()
            let statement = try prepare(
                "INSERT INTO messages (session_id, sender, text, created_at) VALUES (?, ?, ?, ?)"
            )
            defer { sqlite3_finalize(statement) }
            bind(sessionId, statement, 1)
            bind(sender, statement, 2)
            bind(text, statement, 3)
            bind(createdAt, statement, 4)
            try stepDone(statement)
            let record = BudsMessageRecord(
                id: sqlite3_last_insert_rowid(database),
                sessionId: sessionId,
                sender: sender,
                text: text,
                createdAt: createdAt
            )
            if sender == "user" {
                try updateAutomaticTitleIfNeeded(sessionId: sessionId, text: text)
                try rememberDurableFacts(from: text)
                try rememberConversationTopic(from: text, sessionId: sessionId)
            }
            return record
        }
    }

    public func memories(limit: Int = 40) throws -> [BudsMemoryRecord] {
        try queue.sync {
            let statement = try prepare(
                "SELECT id, content, importance, is_core, created_at, scope, session_id FROM memories ORDER BY is_core DESC, importance DESC, id DESC LIMIT ?"
            )
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, Int32(max(1, min(limit, 200))))
            var records: [BudsMemoryRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsMemoryRecord(
                    id: sqlite3_column_int64(statement, 0),
                    content: text(statement, 1),
                    importance: sqlite3_column_double(statement, 2),
                    isCore: sqlite3_column_int(statement, 3) == 1,
                    createdAt: text(statement, 4),
                    scope: text(statement, 5),
                    sessionId: optionalText(statement, 6)
                ))
            }
            return records
        }
    }

    public func memoriesForPrompt(sessionId: String, limit: Int = 16) throws -> [BudsMemoryRecord] {
        try queue.sync {
            let statement = try prepare(
                """
                SELECT id, content, importance, is_core, created_at, scope, session_id
                FROM memories
                WHERE scope = 'global' OR (scope = 'conversation' AND session_id = ?)
                ORDER BY is_core DESC, importance DESC, id DESC LIMIT ?
                """
            )
            defer { sqlite3_finalize(statement) }
            bind(sessionId, statement, 1)
            sqlite3_bind_int(statement, 2, Int32(max(1, min(limit, 80))))
            var records: [BudsMemoryRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsMemoryRecord(
                    id: sqlite3_column_int64(statement, 0),
                    content: text(statement, 1),
                    importance: sqlite3_column_double(statement, 2),
                    isCore: sqlite3_column_int(statement, 3) == 1,
                    createdAt: text(statement, 4),
                    scope: text(statement, 5),
                    sessionId: optionalText(statement, 6)
                ))
            }
            return records
        }
    }

    public func createMemory(content: String, importance: Double = 0.75) throws -> BudsMemoryRecord {
        try queue.sync {
            try ensureWritable()
            let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let value = clean.nonEmpty else {
                throw BudsNativeError.databaseUnavailable("A memória não pode ficar vazia.")
            }
            let statement = try prepare(
                "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id) VALUES (?, ?, 0, ?, 'global', NULL)"
            )
            defer { sqlite3_finalize(statement) }
            bind(String(value.prefix(2_000)), statement, 1)
            sqlite3_bind_double(statement, 2, min(1, max(0.2, importance)))
            bind(Self.now(), statement, 3)
            try stepDone(statement)

            let lookup = try prepare("SELECT id FROM memories WHERE content = ? AND scope = 'global' LIMIT 1")
            defer { sqlite3_finalize(lookup) }
            bind(String(value.prefix(2_000)), lookup, 1)
            guard sqlite3_step(lookup) == SQLITE_ROW,
                  let created = try memory(id: sqlite3_column_int64(lookup, 0)) else {
                throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a memória salva.")
            }
            return created
        }
    }

    public func updateMemory(id: Int64, content: String?, importance: Double?) throws -> BudsMemoryRecord {
        try queue.sync {
            try ensureWritable()
            guard let current = try memory(id: id) else {
                throw BudsNativeError.databaseUnavailable("Memória não encontrada.")
            }
            let cleanContent = content?.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextContent = cleanContent?.nonEmpty ?? current.content
            let nextImportance = min(1, max(0.2, importance ?? current.importance))
            let statement = try prepare("UPDATE memories SET content = ?, importance = ? WHERE id = ?")
            defer { sqlite3_finalize(statement) }
            bind(nextContent, statement, 1)
            sqlite3_bind_double(statement, 2, nextImportance)
            sqlite3_bind_int64(statement, 3, id)
            try stepDone(statement)
            guard let updated = try memory(id: id) else {
                throw BudsNativeError.databaseUnavailable("Memória não encontrada após a atualização.")
            }
            return updated
        }
    }

    public func setCoreMemory(id: Int64, enabled: Bool) throws -> BudsMemoryRecord {
        try queue.sync {
            try ensureWritable()
            let statement = try prepare(
                "UPDATE memories SET is_core = ?, importance = MAX(importance, ?), scope = CASE WHEN ? = 1 THEN 'global' ELSE scope END, session_id = CASE WHEN ? = 1 THEN NULL ELSE session_id END WHERE id = ?"
            )
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, enabled ? 1 : 0)
            sqlite3_bind_double(statement, 2, enabled ? 0.9 : 0.2)
            sqlite3_bind_int(statement, 3, enabled ? 1 : 0)
            sqlite3_bind_int(statement, 4, enabled ? 1 : 0)
            sqlite3_bind_int64(statement, 5, id)
            try stepDone(statement)
            guard let updated = try memory(id: id) else {
                throw BudsNativeError.databaseUnavailable("Memória não encontrada.")
            }
            return updated
        }
    }

    public func deleteMemory(id: Int64, force: Bool) throws {
        try queue.sync {
            try ensureWritable()
            guard let current = try memory(id: id) else { return }
            if current.isCore && !force {
                throw BudsNativeError.databaseUnavailable("Desfixe a Core Memory antes de excluí-la.")
            }
            let statement = try prepare("DELETE FROM memories WHERE id = ?")
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int64(statement, 1, id)
            try stepDone(statement)
        }
    }

    private func open() throws {
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(databaseURL.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            let message = handle.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "erro desconhecido"
            if let handle { sqlite3_close_v2(handle) }
            throw BudsNativeError.databaseUnavailable(message)
        }
        database = handle
        sqlite3_busy_timeout(handle, 4_000)
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA synchronous=NORMAL")
        try execute("PRAGMA foreign_keys=ON")
        try migrate()
    }

    private func migrate() throws {
        try execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """)
        try execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                sender TEXT NOT NULL CHECK(sender IN ('user', 'ia')),
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            """)
        try execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)")
        try migrateMemoryScopeIfNeeded()
        try execute("PRAGMA user_version=2")
    }

    private func ensureWritable() throws {
        do {
            try BudsStorageGuard.requireDatabaseSpace()
        } catch {
            if let database {
                sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_PASSIVE, nil, nil)
            }
            throw error
        }
    }

    private func session(id: String) throws -> BudsSessionRecord? {
        let statement = try prepare("SELECT id, title, created_at FROM sessions WHERE id = ? LIMIT 1")
        defer { sqlite3_finalize(statement) }
        bind(id, statement, 1)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return BudsSessionRecord(
            id: text(statement, 0),
            title: text(statement, 1),
            createdAt: text(statement, 2)
        )
    }

    private func memory(id: Int64) throws -> BudsMemoryRecord? {
        let statement = try prepare(
            "SELECT id, content, importance, is_core, created_at, scope, session_id FROM memories WHERE id = ? LIMIT 1"
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, id)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return BudsMemoryRecord(
            id: sqlite3_column_int64(statement, 0),
            content: text(statement, 1),
            importance: sqlite3_column_double(statement, 2),
            isCore: sqlite3_column_int(statement, 3) == 1,
            createdAt: text(statement, 4),
            scope: text(statement, 5),
            sessionId: optionalText(statement, 6)
        )
    }

    private func updateAutomaticTitleIfNeeded(sessionId: String, text: String) throws {
        guard let current = try session(id: sessionId), current.title == "Nova conversa" else { return }
        let words = text.split(whereSeparator: { $0.isWhitespace }).prefix(7)
        let title = words.joined(separator: " ").prefix(64)
        guard !title.isEmpty else { return }
        let statement = try prepare("UPDATE sessions SET title = ? WHERE id = ?")
        defer { sqlite3_finalize(statement) }
        bind(String(title), statement, 1)
        bind(sessionId, statement, 2)
        try stepDone(statement)
    }

    private func rememberDurableFacts(from text: String) throws {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = clean.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
        let durablePrefixes = [
            "meu nome e ", "eu me chamo ", "eu sou ", "eu gosto de ",
            "eu trabalho com ", "eu moro em ", "prefiro ", "lembre que ",
        ]
        guard clean.count >= 8, clean.count <= 280,
              durablePrefixes.contains(where: { lower.hasPrefix($0) }) else { return }
        let statement = try prepare(
            "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id) VALUES (?, 0.85, 0, ?, 'global', NULL)"
        )
        defer { sqlite3_finalize(statement) }
        bind(clean, statement, 1)
        bind(Self.now(), statement, 2)
        try stepDone(statement)
    }

    private func rememberConversationTopic(from text: String, sessionId: String) throws {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = clean.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
        let trivialMessages: Set<String> = [
            "oi", "ola", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada",
            "valeu", "ok", "okay", "sim", "nao", "teste", "testando",
        ]
        guard clean.count >= 12, !trivialMessages.contains(lower) else { return }

        let compact = clean
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        let topic = String(compact.prefix(360))
        let statement = try prepare(
            "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id) VALUES (?, 0.58, 0, ?, 'conversation', ?)"
        )
        defer { sqlite3_finalize(statement) }
        bind(topic, statement, 1)
        bind(Self.now(), statement, 2)
        bind(sessionId, statement, 3)
        try stepDone(statement)

        // Mantém a Obsidian útil sem fazer o banco crescer indefinidamente.
        try execute("""
            DELETE FROM memories
            WHERE scope = 'conversation' AND is_core = 0 AND id NOT IN (
                SELECT id FROM memories WHERE scope = 'conversation' AND is_core = 0 ORDER BY id DESC LIMIT 240
            )
            """)
    }

    private func migrateMemoryScopeIfNeeded() throws {
        let columns = try tableColumns("memories")
        if columns.isEmpty {
            try createScopedMemoriesTable()
            return
        }
        if columns.contains("scope"), columns.contains("session_id") {
            try createMemoryIndexes()
            return
        }

        try transaction {
            try execute("ALTER TABLE memories RENAME TO memories_legacy_scope")
            try createScopedMemoriesTable()
            // A versão anterior gravava tópicos automáticos com importância
            // 0.58; fatos duráveis/manuais tinham >= 0.7. Tópicos antigos sem
            // sessão ficam arquivados e visíveis, mas jamais entram no prompt.
            try execute("""
                INSERT INTO memories (id, content, importance, is_core, created_at, scope, session_id)
                SELECT id, content, importance, is_core, created_at,
                       CASE WHEN is_core = 1 OR importance >= 0.7 THEN 'global' ELSE 'detached' END,
                       NULL
                FROM memories_legacy_scope
                """)
            try execute("DROP TABLE memories_legacy_scope")
        }
        try createMemoryIndexes()
    }

    private func createScopedMemoriesTable() throws {
        try execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.7,
                is_core INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                scope TEXT NOT NULL DEFAULT 'global',
                session_id TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            """)
        try createMemoryIndexes()
    }

    private func createMemoryIndexes() throws {
        try execute("CREATE INDEX IF NOT EXISTS idx_memories_scope_session ON memories(scope, session_id, id)")
        try execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_global_unique ON memories(content) WHERE scope = 'global'")
        try execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_conversation_unique ON memories(content, session_id) WHERE scope = 'conversation'")
    }

    private func tableColumns(_ table: String) throws -> Set<String> {
        let statement = try prepare("PRAGMA table_info(\(table))")
        defer { sqlite3_finalize(statement) }
        var columns = Set<String>()
        while sqlite3_step(statement) == SQLITE_ROW {
            columns.insert(text(statement, 1))
        }
        return columns
    }

    private func transaction(_ work: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do {
            try work()
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        guard let database else {
            throw BudsNativeError.databaseUnavailable("conexão fechada")
        }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw databaseError()
        }
        return statement
    }

    private func execute(_ sql: String) throws {
        guard let database else {
            throw BudsNativeError.databaseUnavailable("conexão fechada")
        }
        var errorPointer: UnsafeMutablePointer<CChar>?
        let code = sqlite3_exec(database, sql, nil, nil, &errorPointer)
        guard code == SQLITE_OK else {
            let message = errorPointer.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(database))
            sqlite3_free(errorPointer)
            throw BudsNativeError.databaseUnavailable(message)
        }
    }

    private func stepDone(_ statement: OpaquePointer) throws {
        let code = sqlite3_step(statement)
        if code == SQLITE_FULL {
            throw BudsNativeError.insufficientStorage(
                available: BudsStorageGuard.availableBytes(),
                required: BudsStorageGuard.databaseMinimumBytes
            )
        }
        guard code == SQLITE_DONE else { throw databaseError() }
    }

    private func databaseError() -> BudsNativeError {
        guard let database else { return .databaseUnavailable("conexão fechada") }
        return .databaseUnavailable(String(cString: sqlite3_errmsg(database)))
    }

    private func bind(_ value: String, _ statement: OpaquePointer, _ index: Int32) {
        sqlite3_bind_text(statement, index, value, -1, Self.sqliteTransient)
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let pointer = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: pointer)
    }

    private func optionalText(_ statement: OpaquePointer, _ index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else { return nil }
        return text(statement, index)
    }

    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private static func now() -> String {
        ISO8601DateFormatter.buds.string(from: Date())
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

private extension ISO8601DateFormatter {
    static let buds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
