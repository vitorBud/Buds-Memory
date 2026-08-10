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
            let sql = "SELECT id, title, created_at FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC"
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
            let statement = try prepare(
                "UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?"
            )
            defer { sqlite3_finalize(statement) }
            bind(Self.now(), statement, 1)
            bind(id, statement, 2)
            try stepDone(statement)
        }
    }

    public func conversationStorage() throws -> [BudsConversationStorageRecord] {
        try queue.sync {
            let statement = try prepare(
                "SELECT id, title, created_at, deleted_at FROM sessions ORDER BY deleted_at IS NULL, COALESCE(deleted_at, created_at) DESC"
            )
            defer { sqlite3_finalize(statement) }
            var records: [BudsConversationStorageRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                let id = text(statement, 0)
                let messages = try count(table: "messages", sessionId: id)
                let memories = try count(table: "memories", sessionId: id)
                let bytes = try conversationTextBytes(sessionId: id)
                let deletedAt = optionalText(statement, 3)
                records.append(BudsConversationStorageRecord(
                    id: id,
                    title: text(statement, 1),
                    createdAt: text(statement, 2),
                    deletedAt: deletedAt,
                    state: deletedAt == nil ? "active" : "removed",
                    messageCount: messages,
                    memoryCount: memories,
                    totalRecords: messages + memories + 1,
                    estimatedBytes: bytes
                ))
            }

            let legacyCount = try scalarInt(
                "SELECT COUNT(*) FROM memories WHERE session_id IS NULL AND origin_type='legacy' AND is_core=0"
            )
            if legacyCount > 0 {
                records.insert(BudsConversationStorageRecord(
                    id: "__legacy_orphaned__",
                    title: "Memórias antigas sem conversa",
                    createdAt: nil,
                    deletedAt: nil,
                    state: "orphaned",
                    messageCount: 0,
                    memoryCount: legacyCount,
                    totalRecords: legacyCount,
                    estimatedBytes: try scalarInt64(
                        "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM memories WHERE session_id IS NULL AND origin_type='legacy' AND is_core=0"
                    )
                ), at: 0)
            }
            return records
        }
    }

    public func purgeConversation(id: String) throws {
        try queue.sync {
            try ensureWritable()
            try transaction {
                if id == "__legacy_orphaned__" {
                    try execute("DELETE FROM memories WHERE session_id IS NULL AND origin_type='legacy' AND is_core=0")
                    return
                }
                let memories = try prepare("DELETE FROM memories WHERE session_id = ?")
                bind(id, memories, 1)
                try stepDone(memories)
                sqlite3_finalize(memories)

                let messages = try prepare("DELETE FROM messages WHERE session_id = ?")
                bind(id, messages, 1)
                try stepDone(messages)
                sqlite3_finalize(messages)

                let session = try prepare("DELETE FROM sessions WHERE id = ?")
                bind(id, session, 1)
                try stepDone(session)
                sqlite3_finalize(session)
            }
        }
    }

    public func clearAllData() throws {
        try queue.sync {
            try transaction {
                try execute("DELETE FROM focus_inbox")
                try execute("DELETE FROM focus_timeline")
                try execute("DELETE FROM focus_decisions")
                try execute("DELETE FROM focus_ideas")
                try execute("DELETE FROM focus_tasks")
                try execute("DELETE FROM messages")
                try execute("DELETE FROM memories")
                try execute("DELETE FROM sessions")
                try execute("DELETE FROM sqlite_sequence WHERE name IN ('messages', 'memories', 'focus_tasks', 'focus_ideas', 'focus_decisions', 'focus_timeline', 'focus_inbox')")
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
                try rememberDurableFacts(from: text, sessionId: sessionId)
                try rememberConversationTopic(from: text, sessionId: sessionId)
                // O Focus nativo não possui o detector Flask em background.
                // Captura apenas intenções explícitas para não aquecer o aparelho
                // com uma segunda inferência depois de cada mensagem.
                try? captureFocusCandidates(from: text, sessionId: sessionId, messageId: record.id)
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
                "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id, origin_type) VALUES (?, ?, 0, ?, 'global', NULL, 'manual')"
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
                "UPDATE memories SET is_core = ?, importance = MAX(importance, ?), scope = CASE WHEN ? = 1 THEN 'global' ELSE scope END WHERE id = ?"
            )
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, enabled ? 1 : 0)
            sqlite3_bind_double(statement, 2, enabled ? 0.9 : 0.2)
            sqlite3_bind_int(statement, 3, enabled ? 1 : 0)
            sqlite3_bind_int64(statement, 4, id)
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

    public func focusTasks() throws -> [BudsFocusTaskRecord] {
        try queue.sync {
            let statement = try prepare(
                """
                SELECT id, title, category, priority, completed, is_focus, created_at, updated_at, due_date,
                       item_type, source, source_session_id, source_message_id, confidence
                FROM focus_tasks
                ORDER BY completed ASC,
                         CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                         created_at DESC
                """
            )
            defer { sqlite3_finalize(statement) }
            var records: [BudsFocusTaskRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(focusTaskRecord(statement))
            }
            return records
        }
    }

    public func createFocusTask(
        title: String,
        category: String,
        priority: String,
        isFocus: Bool,
        dueDate: String?,
        itemType: String = "TASK"
    ) throws -> BudsFocusTaskRecord {
        try queue.sync {
            try ensureWritable()
            let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let cleanTitle = cleanTitle.nonEmpty else {
                throw BudsNativeError.databaseUnavailable("O título da tarefa não pode ficar vazio.")
            }
            let cleanCategory = Self.focusCategories.contains(category) ? category : "other"
            let cleanPriority = Self.focusPriorities.contains(priority) ? priority : "medium"

            let duplicate = try prepare(
                "SELECT id FROM focus_tasks WHERE completed = 0 AND lower(trim(title)) = lower(trim(?)) LIMIT 1"
            )
            bind(cleanTitle, duplicate, 1)
            if sqlite3_step(duplicate) == SQLITE_ROW {
                let existingId = sqlite3_column_int64(duplicate, 0)
                sqlite3_finalize(duplicate)
                guard let existing = try focusTask(id: existingId) else {
                    throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a tarefa existente.")
                }
                return existing
            }
            sqlite3_finalize(duplicate)

            if isFocus { try execute("UPDATE focus_tasks SET is_focus = 0") }
            let now = Self.now()
            let statement = try prepare(
                """
                INSERT INTO focus_tasks
                    (title, category, priority, completed, is_focus, created_at, updated_at, due_date,
                     item_type, source, confidence)
                VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 'manual', 1.0)
                """
            )
            defer { sqlite3_finalize(statement) }
            bind(String(cleanTitle.prefix(500)), statement, 1)
            bind(cleanCategory, statement, 2)
            bind(cleanPriority, statement, 3)
            sqlite3_bind_int(statement, 4, isFocus ? 1 : 0)
            bind(now, statement, 5)
            bind(now, statement, 6)
            bindOptional(dueDate, statement, 7)
            bind(itemType == "REMINDER" ? "REMINDER" : "TASK", statement, 8)
            try stepDone(statement)
            let id = sqlite3_last_insert_rowid(database)
            try logFocusEvent(eventType: itemType == "REMINDER" ? "reminder_created" : "task_created", title: cleanTitle)
            guard let created = try focusTask(id: id) else {
                throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a tarefa criada.")
            }
            return created
        }
    }

    public func updateFocusTask(
        id: Int64,
        title: String?,
        category: String?,
        priority: String?,
        completed: Bool?,
        isFocus: Bool?
    ) throws -> BudsFocusTaskRecord {
        try queue.sync {
            try ensureWritable()
            guard let current = try focusTask(id: id) else {
                throw BudsNativeError.databaseUnavailable("Tarefa não encontrada.")
            }
            let nextTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? current.title
            let nextCategory = category.flatMap { Self.focusCategories.contains($0) ? $0 : nil } ?? current.category
            let nextPriority = priority.flatMap { Self.focusPriorities.contains($0) ? $0 : nil } ?? current.priority
            let nextCompleted = completed ?? current.completed
            let nextIsFocus = isFocus ?? current.isFocus
            if nextIsFocus { try execute("UPDATE focus_tasks SET is_focus = 0") }

            let statement = try prepare(
                """
                UPDATE focus_tasks
                SET title = ?, category = ?, priority = ?, completed = ?, is_focus = ?, updated_at = ?
                WHERE id = ?
                """
            )
            defer { sqlite3_finalize(statement) }
            bind(String(nextTitle.prefix(500)), statement, 1)
            bind(nextCategory, statement, 2)
            bind(nextPriority, statement, 3)
            sqlite3_bind_int(statement, 4, nextCompleted ? 1 : 0)
            sqlite3_bind_int(statement, 5, nextIsFocus ? 1 : 0)
            bind(Self.now(), statement, 6)
            sqlite3_bind_int64(statement, 7, id)
            try stepDone(statement)

            if let completed, completed != current.completed {
                try logFocusEvent(
                    eventType: completed ? "task_completed" : "task_reopened",
                    title: nextTitle
                )
            } else if isFocus == true, !current.isFocus {
                try logFocusEvent(eventType: "focus_changed", title: nextTitle)
            }
            guard let updated = try focusTask(id: id) else {
                throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a tarefa atualizada.")
            }
            return updated
        }
    }

    public func deleteFocusTask(id: Int64) throws {
        try queue.sync {
            try ensureWritable()
            let statement = try prepare("DELETE FROM focus_tasks WHERE id = ?")
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int64(statement, 1, id)
            try stepDone(statement)
        }
    }

    public func createFocusIdea(content: String) throws {
        try queue.sync {
            try ensureWritable()
            let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let clean = clean.nonEmpty else { return }
            let statement = try prepare(
                "INSERT INTO focus_ideas (content, status, source, created_at) VALUES (?, 'active', 'dump', ?)"
            )
            defer { sqlite3_finalize(statement) }
            bind(String(clean.prefix(2_000)), statement, 1)
            bind(Self.now(), statement, 2)
            try stepDone(statement)
            try logFocusEvent(eventType: "idea_saved", title: clean)
        }
    }

    public func createFocusDecision(content: String) throws {
        try queue.sync {
            try ensureWritable()
            let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let clean = clean.nonEmpty else { return }
            let statement = try prepare(
                "INSERT INTO focus_decisions (content, source, created_at) VALUES (?, 'dump', ?)"
            )
            defer { sqlite3_finalize(statement) }
            bind(String(clean.prefix(2_000)), statement, 1)
            bind(Self.now(), statement, 2)
            try stepDone(statement)
            try logFocusEvent(eventType: "decision_saved", title: clean)
        }
    }

    public func focusTimeline() throws -> [BudsFocusTimelineRecord] {
        try queue.sync {
            let today = String(Self.now().prefix(10))
            let statement = try prepare(
                """
                SELECT id, event_type, title, details, created_at FROM focus_timeline
                WHERE substr(created_at, 1, 10) = ? ORDER BY id DESC LIMIT 100
                """
            )
            defer { sqlite3_finalize(statement) }
            bind(today, statement, 1)
            var records: [BudsFocusTimelineRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsFocusTimelineRecord(
                    id: sqlite3_column_int64(statement, 0),
                    eventType: text(statement, 1),
                    title: text(statement, 2),
                    details: text(statement, 3),
                    createdAt: text(statement, 4)
                ))
            }
            return records
        }
    }

    public func focusInbox() throws -> [BudsFocusInboxRecord] {
        try queue.sync {
            let statement = try prepare(
                """
                SELECT id, item_type, content, metadata, source, status, created_at
                FROM focus_inbox WHERE status = 'pending' ORDER BY id DESC
                """
            )
            defer { sqlite3_finalize(statement) }
            var records: [BudsFocusInboxRecord] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                records.append(BudsFocusInboxRecord(
                    id: sqlite3_column_int64(statement, 0),
                    itemType: text(statement, 1),
                    content: text(statement, 2),
                    metadata: text(statement, 3),
                    source: text(statement, 4),
                    status: text(statement, 5),
                    createdAt: text(statement, 6)
                ))
            }
            return records
        }
    }

    public func updateFocusInbox(id: Int64, status: String) throws {
        try queue.sync {
            try ensureWritable()
            guard status == "approved" || status == "ignored" else {
                throw BudsNativeError.databaseUnavailable("Status inválido para a Buds Inbox.")
            }
            let lookup = try prepare("SELECT item_type, content, metadata, dedup_key FROM focus_inbox WHERE id = ? AND status = 'pending'")
            sqlite3_bind_int64(lookup, 1, id)
            guard sqlite3_step(lookup) == SQLITE_ROW else {
                sqlite3_finalize(lookup)
                throw BudsNativeError.databaseUnavailable("Item da Buds Inbox não encontrado.")
            }
            let itemType = text(lookup, 0)
            let content = text(lookup, 1)
            let metadataText = text(lookup, 2)
            let dedupKey = optionalText(lookup, 3)
            sqlite3_finalize(lookup)

            let metadata = (try? JSONSerialization.jsonObject(with: Data(metadataText.utf8))) as? [String: Any] ?? [:]

            if status == "approved" {
                switch itemType.uppercased() {
                case "TASK", "REMINDER":
                    _ = try createFocusTaskInsideQueue(
                        title: content,
                        category: metadata["category"] as? String ?? "other",
                        priority: metadata["priority"] as? String ?? "medium",
                        dueDate: metadata["due_date"] as? String,
                        itemType: itemType.uppercased(),
                        source: "inbox",
                        sourceSessionId: metadata["session_id"] as? String,
                        sourceMessageId: (metadata["message_id"] as? NSNumber)?.int64Value,
                        dedupKey: dedupKey,
                        confidence: (metadata["confidence"] as? NSNumber)?.doubleValue ?? 0.75
                    )
                case "IDEA":
                    try createFocusIdeaInsideQueue(content: content)
                case "DECISION":
                    try createFocusDecisionInsideQueue(content: content)
                case "MEMORY":
                    try createMemoryInsideQueue(content: content, sessionId: metadata["session_id"] as? String)
                default:
                    break
                }
            }
            let statement = try prepare("UPDATE focus_inbox SET status = ? WHERE id = ?")
            defer { sqlite3_finalize(statement) }
            bind(status, statement, 1)
            sqlite3_bind_int64(statement, 2, id)
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
                created_at TEXT NOT NULL,
                deleted_at TEXT
            )
            """)
        if !((try? tableColumns("sessions")) ?? []).contains("deleted_at") {
            try execute("ALTER TABLE sessions ADD COLUMN deleted_at TEXT")
        }
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
        let memoryColumns = try tableColumns("memories")
        if !memoryColumns.contains("origin_type") {
            try execute("ALTER TABLE memories ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'legacy'")
        }
        try migrateFocus()
        try execute("PRAGMA user_version=4")
    }

    private func migrateFocus() throws {
        try execute("""
            CREATE TABLE IF NOT EXISTS focus_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                priority TEXT NOT NULL DEFAULT 'medium',
                completed INTEGER NOT NULL DEFAULT 0,
                is_focus INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                due_date TEXT,
                item_type TEXT NOT NULL DEFAULT 'TASK',
                source TEXT NOT NULL DEFAULT 'manual',
                source_session_id TEXT,
                source_message_id INTEGER,
                dedup_key TEXT,
                confidence REAL NOT NULL DEFAULT 1.0
            )
            """)
        try execute("""
            CREATE TABLE IF NOT EXISTS focus_ideas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                source TEXT NOT NULL DEFAULT 'dump',
                created_at TEXT NOT NULL
            )
            """)
        try execute("""
            CREATE TABLE IF NOT EXISTS focus_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'dump',
                created_at TEXT NOT NULL
            )
            """)
        try execute("""
            CREATE TABLE IF NOT EXISTS focus_timeline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
            """)
        try execute("""
            CREATE TABLE IF NOT EXISTS focus_inbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_type TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                source TEXT NOT NULL DEFAULT 'chat',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                dedup_key TEXT
            )
            """)
        let taskColumns = try tableColumns("focus_tasks")
        if !taskColumns.contains("item_type") { try execute("ALTER TABLE focus_tasks ADD COLUMN item_type TEXT NOT NULL DEFAULT 'TASK'") }
        if !taskColumns.contains("source") { try execute("ALTER TABLE focus_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'") }
        if !taskColumns.contains("source_session_id") { try execute("ALTER TABLE focus_tasks ADD COLUMN source_session_id TEXT") }
        if !taskColumns.contains("source_message_id") { try execute("ALTER TABLE focus_tasks ADD COLUMN source_message_id INTEGER") }
        if !taskColumns.contains("dedup_key") { try execute("ALTER TABLE focus_tasks ADD COLUMN dedup_key TEXT") }
        if !taskColumns.contains("confidence") { try execute("ALTER TABLE focus_tasks ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0") }
        let inboxColumns = try tableColumns("focus_inbox")
        if !inboxColumns.contains("dedup_key") { try execute("ALTER TABLE focus_inbox ADD COLUMN dedup_key TEXT") }
        try execute("CREATE INDEX IF NOT EXISTS idx_focus_tasks_state ON focus_tasks(completed, is_focus, priority)")
        try execute("CREATE INDEX IF NOT EXISTS idx_focus_timeline_created ON focus_timeline(created_at)")
        try execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_tasks_dedup ON focus_tasks(dedup_key) WHERE dedup_key IS NOT NULL AND completed = 0")
        try execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_inbox_dedup ON focus_inbox(dedup_key) WHERE dedup_key IS NOT NULL AND status = 'pending'")
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

    private func focusTask(id: Int64) throws -> BudsFocusTaskRecord? {
        let statement = try prepare(
            """
            SELECT id, title, category, priority, completed, is_focus, created_at, updated_at, due_date,
                   item_type, source, source_session_id, source_message_id, confidence
            FROM focus_tasks WHERE id = ? LIMIT 1
            """
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, id)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return focusTaskRecord(statement)
    }

    private func focusTaskRecord(_ statement: OpaquePointer) -> BudsFocusTaskRecord {
        BudsFocusTaskRecord(
            id: sqlite3_column_int64(statement, 0),
            title: text(statement, 1),
            category: text(statement, 2),
            priority: text(statement, 3),
            completed: sqlite3_column_int(statement, 4) == 1,
            isFocus: sqlite3_column_int(statement, 5) == 1,
            createdAt: text(statement, 6),
            updatedAt: text(statement, 7),
            dueDate: optionalText(statement, 8),
            itemType: text(statement, 9),
            source: text(statement, 10),
            sourceSessionId: optionalText(statement, 11),
            sourceMessageId: sqlite3_column_type(statement, 12) == SQLITE_NULL ? nil : sqlite3_column_int64(statement, 12),
            confidence: sqlite3_column_double(statement, 13)
        )
    }

    private func createFocusTaskInsideQueue(
        title: String,
        category: String = "other",
        priority: String = "medium",
        dueDate: String? = nil,
        itemType: String = "TASK",
        source: String = "inbox",
        sourceSessionId: String? = nil,
        sourceMessageId: Int64? = nil,
        dedupKey: String? = nil,
        confidence: Double = 0.75
    ) throws -> BudsFocusTaskRecord {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let clean = clean.nonEmpty else {
            throw BudsNativeError.databaseUnavailable("O título da tarefa não pode ficar vazio.")
        }
        if let dedupKey {
            let duplicate = try prepare("SELECT id FROM focus_tasks WHERE dedup_key = ? AND completed = 0 LIMIT 1")
            bind(dedupKey, duplicate, 1)
            if sqlite3_step(duplicate) == SQLITE_ROW {
                let existingId = sqlite3_column_int64(duplicate, 0)
                sqlite3_finalize(duplicate)
                guard let task = try focusTask(id: existingId) else {
                    throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a tarefa existente.")
                }
                return task
            }
            sqlite3_finalize(duplicate)
        }
        let statement = try prepare(
            """
            INSERT INTO focus_tasks
                (title, category, priority, completed, is_focus, created_at, updated_at, due_date,
                 item_type, source, source_session_id, source_message_id, dedup_key, confidence)
            VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
        )
        defer { sqlite3_finalize(statement) }
        let now = Self.now()
        bind(String(clean.prefix(500)), statement, 1)
        bind(Self.focusCategories.contains(category) ? category : "other", statement, 2)
        bind(Self.focusPriorities.contains(priority) ? priority : "medium", statement, 3)
        bind(now, statement, 4)
        bind(now, statement, 5)
        bindOptional(dueDate, statement, 6)
        bind(itemType == "REMINDER" ? "REMINDER" : "TASK", statement, 7)
        bind(source, statement, 8)
        bindOptional(sourceSessionId, statement, 9)
        if let sourceMessageId { sqlite3_bind_int64(statement, 10, sourceMessageId) } else { sqlite3_bind_null(statement, 10) }
        bindOptional(dedupKey, statement, 11)
        sqlite3_bind_double(statement, 12, min(1, max(0, confidence)))
        try stepDone(statement)
        let id = sqlite3_last_insert_rowid(database)
        try logFocusEvent(eventType: itemType == "REMINDER" ? "reminder_created" : "task_created", title: clean)
        guard let task = try focusTask(id: id) else {
            throw BudsNativeError.databaseUnavailable("Não foi possível recuperar a tarefa criada.")
        }
        return task
    }

    private func createFocusIdeaInsideQueue(content: String) throws {
        let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let clean = clean.nonEmpty else { return }
        let statement = try prepare(
            "INSERT INTO focus_ideas (content, status, source, created_at) VALUES (?, 'active', 'inbox', ?)"
        )
        defer { sqlite3_finalize(statement) }
        bind(String(clean.prefix(2_000)), statement, 1)
        bind(Self.now(), statement, 2)
        try stepDone(statement)
        try logFocusEvent(eventType: "idea_saved", title: clean)
    }

    private func createFocusDecisionInsideQueue(content: String) throws {
        let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let clean = clean.nonEmpty else { return }
        let statement = try prepare(
            "INSERT INTO focus_decisions (content, source, created_at) VALUES (?, 'inbox', ?)"
        )
        defer { sqlite3_finalize(statement) }
        bind(String(clean.prefix(2_000)), statement, 1)
        bind(Self.now(), statement, 2)
        try stepDone(statement)
        try logFocusEvent(eventType: "decision_saved", title: clean)
    }

    private func createMemoryInsideQueue(content: String, sessionId: String?) throws {
        let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let clean = clean.nonEmpty else { return }
        let statement = try prepare(
            """
            INSERT OR IGNORE INTO memories
                (content, importance, is_core, created_at, scope, session_id, origin_type)
            VALUES (?, 0.8, 0, ?, ?, ?, 'focus_inbox')
            """
        )
        defer { sqlite3_finalize(statement) }
        bind(String(clean.prefix(2_000)), statement, 1)
        bind(Self.now(), statement, 2)
        bind(sessionId == nil ? "global" : "conversation", statement, 3)
        bindOptional(sessionId, statement, 4)
        try stepDone(statement)
        try logFocusEvent(eventType: "memory_saved", title: clean)
    }

    private func captureFocusCandidates(from text: String, sessionId: String, messageId: Int64) throws {
        for candidate in BudsFocusCapture.detect(text) {
            if candidate.autoApply && ["TASK", "REMINDER"].contains(candidate.itemType) {
                _ = try createFocusTaskInsideQueue(
                    title: candidate.content,
                    category: candidate.category,
                    priority: candidate.priority,
                    dueDate: candidate.dueDate,
                    itemType: candidate.itemType,
                    source: "chat",
                    sourceSessionId: sessionId,
                    sourceMessageId: messageId,
                    dedupKey: candidate.dedupKey,
                    confidence: candidate.confidence
                )
                continue
            }

            let duplicate = try prepare("SELECT 1 FROM focus_inbox WHERE dedup_key = ? AND status = 'pending' LIMIT 1")
            bind(candidate.dedupKey, duplicate, 1)
            let alreadyExists = sqlite3_step(duplicate) == SQLITE_ROW
            sqlite3_finalize(duplicate)
            guard !alreadyExists else { continue }

            let metadataObject: [String: Any] = [
                "session_id": sessionId,
                "message_id": messageId,
                "category": candidate.category,
                "priority": candidate.priority,
                "due_date": candidate.dueDate as Any,
                "confidence": candidate.confidence,
            ]
            let metadataData = try JSONSerialization.data(withJSONObject: metadataObject)
            let metadata = String(data: metadataData, encoding: .utf8) ?? "{}"
            let statement = try prepare(
                """
                INSERT OR IGNORE INTO focus_inbox
                    (item_type, content, metadata, source, status, created_at, dedup_key)
                VALUES (?, ?, ?, 'chat', 'pending', ?, ?)
                """
            )
            bind(candidate.itemType, statement, 1)
            bind(candidate.content, statement, 2)
            bind(metadata, statement, 3)
            bind(Self.now(), statement, 4)
            bind(candidate.dedupKey, statement, 5)
            try stepDone(statement)
            sqlite3_finalize(statement)
        }
    }

    private func logFocusEvent(eventType: String, title: String) throws {
        let statement = try prepare(
            "INSERT INTO focus_timeline (event_type, title, details, created_at) VALUES (?, ?, '{}', ?)"
        )
        defer { sqlite3_finalize(statement) }
        bind(eventType, statement, 1)
        bind(String(title.prefix(2_000)), statement, 2)
        bind(Self.now(), statement, 3)
        try stepDone(statement)
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

    private func rememberDurableFacts(from text: String, sessionId: String) throws {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = clean.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
        let durablePrefixes = [
            "meu nome e ", "eu me chamo ", "eu sou ", "eu gosto de ",
            "eu trabalho com ", "eu moro em ", "prefiro ", "lembre que ",
        ]
        guard clean.count >= 8, clean.count <= 280,
              durablePrefixes.contains(where: { lower.hasPrefix($0) }) else { return }
        let statement = try prepare(
            "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id, origin_type) VALUES (?, 0.85, 0, ?, 'global', ?, 'conversation')"
        )
        defer { sqlite3_finalize(statement) }
        bind(clean, statement, 1)
        bind(Self.now(), statement, 2)
        bind(sessionId, statement, 3)
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
            "INSERT OR IGNORE INTO memories (content, importance, is_core, created_at, scope, session_id, origin_type) VALUES (?, 0.58, 0, ?, 'conversation', ?, 'conversation')"
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
                origin_type TEXT NOT NULL DEFAULT 'legacy',
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

    private func count(table: String, sessionId: String) throws -> Int {
        let statement = try prepare("SELECT COUNT(*) FROM \(table) WHERE session_id = ?")
        defer { sqlite3_finalize(statement) }
        bind(sessionId, statement, 1)
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int64(statement, 0))
    }

    private func conversationTextBytes(sessionId: String) throws -> Int64 {
        let statement = try prepare(
            """
            SELECT
              COALESCE((SELECT SUM(LENGTH(text)) FROM messages WHERE session_id=?), 0) +
              COALESCE((SELECT SUM(LENGTH(content)) FROM memories WHERE session_id=?), 0)
            """
        )
        defer { sqlite3_finalize(statement) }
        bind(sessionId, statement, 1)
        bind(sessionId, statement, 2)
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return sqlite3_column_int64(statement, 0)
    }

    private func scalarInt(_ sql: String) throws -> Int {
        Int(try scalarInt64(sql))
    }

    private func scalarInt64(_ sql: String) throws -> Int64 {
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return sqlite3_column_int64(statement, 0)
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

    private func bindOptional(_ value: String?, _ statement: OpaquePointer, _ index: Int32) {
        if let value {
            bind(value, statement, index)
        } else {
            sqlite3_bind_null(statement, index)
        }
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
    private static let focusCategories: Set<String> = ["work", "study", "personal", "project", "other"]
    private static let focusPriorities: Set<String> = ["low", "medium", "high"]

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
