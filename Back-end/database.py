import sqlite3
from pathlib import Path
import uuid
import datetime
import re

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "chat_history.db"

def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    # Habilita suporte a chaves estrangeiras (cascade delete)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    with get_db_connection() as conn:
        # Tabela de sessões
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        # Tabela de mensagens vinculadas
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                audio_url TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            );
        """)
        conn.commit()

def create_session(title=None):
    session_id = str(uuid.uuid4())
    if not title:
        title = f"Conversa {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}"
    created_at = datetime.datetime.now().isoformat()
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?);",
            (session_id, title, created_at)
        )
        conn.commit()
    return {"id": session_id, "title": title, "created_at": created_at}

def make_title_from_message(text):
    title = re.sub(r"```[\s\S]*?```", " ", text or "")
    title = re.sub(r"`([^`]*)`", r"\1", title)
    title = re.sub(r"https?://\S+", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" .,:;!?-_\n\t")

    if not title:
        return f"Conversa {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}"

    first_sentence = re.split(r"(?<=[.!?])\s+", title)[0].strip()
    if 12 <= len(first_sentence) <= 58:
        title = first_sentence

    if len(title) > 58:
        title = title[:55].rstrip(" ,.;:-") + "..."

    return title[:1].upper() + title[1:]

def get_session(session_id):
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?;",
            (session_id,)
        ).fetchone()
        return dict(row) if row else None

def get_all_sessions():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM sessions ORDER BY created_at DESC;").fetchall()
        return [dict(row) for row in rows]

def delete_session(session_id):
    with get_db_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?;", (session_id,))
        conn.commit()
    return True

def update_session_title(session_id, title):
    title = (title or "").strip()
    if not title:
        raise ValueError("O título não pode ficar vazio.")

    with get_db_connection() as conn:
        cursor = conn.execute(
            "UPDATE sessions SET title = ? WHERE id = ?;",
            (title, session_id)
        )
        conn.commit()

    if cursor.rowcount == 0:
        raise ValueError("Sessão não encontrada.")

    session = get_session(session_id)
    return session or {"id": session_id, "title": title}

def add_message(session_id, sender, text, audio_url=None):
    created_at = datetime.datetime.now().isoformat()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO messages (session_id, sender, text, audio_url, created_at) 
               VALUES (?, ?, ?, ?, ?);""",
            (session_id, sender, text, audio_url, created_at)
        )
        conn.commit()
        msg_id = cursor.lastrowid
    return {
        "id": msg_id,
        "session_id": session_id,
        "sender": sender,
        "text": text,
        "audio_url": audio_url,
        "created_at": created_at
    }

def get_session_messages(session_id):
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC;",
            (session_id,)
        ).fetchall()
        return [dict(row) for row in rows]

def get_recent_session_messages(session_id, limit=12):
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM (
                SELECT * FROM messages
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT ?
            )
            ORDER BY id ASC;
            """,
            (session_id, limit)
        ).fetchall()
        return [dict(row) for row in rows]

# Inicializa o banco ao rodar o script diretamente
if __name__ == "__main__":
    init_db()
    print("Banco de dados SQLite inicializado com sucesso!")
