import sqlite3
from pathlib import Path
import uuid
import datetime
import re
from storage import get_database_path

BASE = Path(__file__).resolve().parent
DB_PATH = get_database_path()

SEARCH_STOP_WORDS = {
    "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "para", "por", "com", "sem", "que", "qual", "quais",
    "como", "quando", "onde", "isso", "esse", "essa", "isto", "voce", "você", "me", "te",
    "ele", "ela", "eles", "elas", "se", "sua", "seu", "minha", "meu", "sobre", "pdf",
    "arquivo", "documento", "aprendeu", "aprendi", "aprendido", "conteudo", "conteúdo",
}


def normalize_search_text(text):
    text = (text or "").lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[^a-zà-ÿ0-9_\-\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def get_search_terms(text, limit=10):
    terms = []
    for word in normalize_search_text(text).split():
        plain = word.strip("_-")
        if len(plain) < 3 or plain.isnumeric() or plain in SEARCH_STOP_WORDS:
            continue
        if plain not in terms:
            terms.append(plain)
        if len(terms) >= limit:
            break
    return terms


def split_content_chunks(content, chunk_size=1200, overlap=160):
    content = re.sub(r"\s+", " ", content or "").strip()
    if not content:
        return []

    chunks = []
    step = max(400, chunk_size - overlap)
    for start in range(0, len(content), step):
        chunk = content[start:start + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        if start + chunk_size >= len(content):
            break
    return chunks


def score_text(text, terms):
    searchable = normalize_search_text(text)
    if not searchable:
        return 0
    score = 0
    for term in terms:
        if term in searchable:
            score += searchable.count(term)
    return score

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
        # Fontes de conhecimento importadas pelo usuário para cada sessão.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_name TEXT,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                topics TEXT NOT NULL,
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

def add_knowledge_source(session_id, title, source_type, source_name, summary, content, topics):
    created_at = datetime.datetime.now().isoformat()
    topics_text = ",".join(topics or [])
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO knowledge_sources
            (session_id, title, source_type, source_name, summary, content, topics, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (session_id, title, source_type, source_name, summary, content, topics_text, created_at)
        )
        conn.commit()
        item_id = cursor.lastrowid

    return {
        "id": item_id,
        "session_id": session_id,
        "title": title,
        "source_type": source_type,
        "source_name": source_name,
        "summary": summary,
        "content": content,
        "topics": topics or [],
        "created_at": created_at,
    }

def get_session_knowledge(session_id, limit=20):
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM knowledge_sources
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?;
            """,
            (session_id, limit)
        ).fetchall()

    items = []
    for row in rows:
        item = dict(row)
        item["topics"] = [topic for topic in item.get("topics", "").split(",") if topic]
        items.append(item)
    return items

def build_knowledge_context(session_id, limit=4, query=None):
    sources = get_session_knowledge(session_id, limit=limit)
    if not sources:
        return ""

    query_terms = get_search_terms(query or "")
    lines = [
        "Conhecimento importado pelo usuário para esta conversa. Use este material como fonte prioritária quando a pergunta tocar nesses assuntos.",
        f"Pergunta atual do usuário: {query or 'não informada'}",
    ]
    ranked_sources = []
    for source in sources:
        source_signal = " ".join([
            str(source.get("title") or ""),
            str(source.get("source_type") or ""),
            str(source.get("source_name") or ""),
            str(source.get("summary") or ""),
            " ".join(source.get("topics") or []),
        ])
        ranked_sources.append((score_text(source_signal, query_terms), source))

    ranked_sources.sort(key=lambda item: item[0], reverse=True)

    for index, (_source_score, source) in enumerate(ranked_sources, start=1):
        content = source.get("content") or ""
        chunks = split_content_chunks(content)
        ranked_chunks = sorted(
            ((score_text(chunk, query_terms), chunk) for chunk in chunks),
            key=lambda item: item[0],
            reverse=True,
        )
        selected_chunks = [chunk for score, chunk in ranked_chunks if score > 0][:2]
        if not selected_chunks:
            selected_chunks = chunks[:1]

        topics = ", ".join(source.get("topics") or [])
        excerpts = "\n".join(
            f"Trecho {chunk_index}: {chunk}"
            for chunk_index, chunk in enumerate(selected_chunks, start=1)
        )
        lines.append(
            f"{index}. {source.get('title')}\n"
            f"Tipo: {source.get('source_type')} · Origem: {source.get('source_name') or 'manual'}\n"
            f"Tópicos: {topics or 'não detectados'}\n"
            f"Resumo: {(source.get('summary') or '')[:520]}\n"
            f"Trechos úteis para a pergunta:\n{excerpts}"
        )
    return "\n\n".join(lines)

# Inicializa o banco ao rodar o script diretamente
if __name__ == "__main__":
    init_db()
    print("Banco de dados SQLite inicializado com sucesso!")
