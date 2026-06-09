"""
cognitive/knowledge_graph.py — Grafo de Conhecimento do Nexus IA.

Representa entidades (tecnologias, projetos, conceitos, pessoas, eventos)
e relações entre elas, armazenado em tabelas de adjacência no SQLite.

Exemplo:
  React ─[uses]→ useState
  Nexus IA ─[part_of]→ Python
  useState ─[learned_in]→ Projeto ProgressDay
"""

from __future__ import annotations

import json
import re
from typing import Optional
from database_v2 import get_db_connection, now_iso, json_dumps, json_loads


# ── Tipos de entidade ────────────────────────────────────────────────────────
ENTITY_TYPES = {"technology", "project", "concept", "person", "event", "tool", "library"}

# ── Tipos de relação ─────────────────────────────────────────────────────────
RELATION_TYPES = {
    "uses", "part_of", "learned_in", "related_to", "created",
    "depends_on", "extends", "implements", "applies_to", "mentions",
}

# ── Detecção automática de tecnologias ──────────────────────────────────────
KNOWN_TECHNOLOGIES: dict[str, str] = {
    "python": "technology", "javascript": "technology", "typescript": "technology",
    "react": "library", "vue": "library", "angular": "library", "svelte": "library",
    "next.js": "library", "nextjs": "library", "vite": "tool",
    "flask": "library", "django": "library", "fastapi": "library",
    "node": "technology", "nodejs": "technology", "node.js": "technology",
    "postgresql": "technology", "sqlite": "technology", "mysql": "technology",
    "mongodb": "technology", "supabase": "tool", "firebase": "tool",
    "docker": "tool", "git": "tool", "github": "tool",
    "ollama": "tool", "whisper": "tool", "piper": "tool",
    "three.js": "library", "framer": "library", "tailwind": "library",
    "css": "technology", "html": "technology", "sql": "technology",
    "numpy": "library", "pandas": "library", "scikit-learn": "library",
    "openai": "tool", "langchain": "library",
}


# ── Escrita ──────────────────────────────────────────────────────────────────

def upsert_entity(
    name: str,
    entity_type: str = "concept",
    description: Optional[str] = None,
    importance: float = 0.5,
    metadata: Optional[dict] = None,
) -> dict:
    """
    Cria uma entidade nova ou atualiza last_seen e importance se já existir.
    Retorna o dict da entidade.
    """
    name_clean = _clean_name(name)
    if not name_clean:
        raise ValueError(f"Nome de entidade inválido: {name!r}")

    entity_type = entity_type if entity_type in ENTITY_TYPES else "concept"
    metadata_str = json_dumps(metadata or {})
    ts = now_iso()

    with get_db_connection() as conn:
        existing = conn.execute(
            "SELECT * FROM kg_entities WHERE name = ?", (name_clean,)
        ).fetchone()

        if existing:
            new_imp = max(existing["importance"], importance)
            conn.execute(
                """
                UPDATE kg_entities
                SET last_seen=?, importance=?, access_count=access_count+1,
                    description=COALESCE(?, description)
                WHERE name=?
                """,
                (ts, new_imp, description, name_clean),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM kg_entities WHERE name=?", (name_clean,)
            ).fetchone()
        else:
            cursor = conn.execute(
                """
                INSERT INTO kg_entities
                  (name, entity_type, description, importance, access_count,
                   first_seen, last_seen, metadata)
                VALUES (?,?,?,?,0,?,?,?)
                """,
                (name_clean, entity_type, description, importance, ts, ts, metadata_str),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM kg_entities WHERE id=?", (cursor.lastrowid,)
            ).fetchone()

    return _entity_to_dict(row)


def add_relation(
    source_name: str,
    target_name: str,
    relation_type: str = "related_to",
    strength: float = 0.5,
) -> Optional[dict]:
    """Cria ou reforça relação entre duas entidades."""
    relation_type = relation_type if relation_type in RELATION_TYPES else "related_to"

    source = _get_entity_by_name(source_name)
    target = _get_entity_by_name(target_name)
    if not source or not target:
        return None

    ts = now_iso()
    with get_db_connection() as conn:
        existing = conn.execute(
            """
            SELECT id, strength FROM kg_relations
            WHERE source_id=? AND target_id=? AND relation_type=?
            """,
            (source["id"], target["id"], relation_type),
        ).fetchone()

        if existing:
            new_strength = min(1.0, existing["strength"] + 0.05)
            conn.execute(
                "UPDATE kg_relations SET strength=? WHERE id=?",
                (new_strength, existing["id"]),
            )
            conn.commit()
            return {"source": source_name, "target": target_name,
                    "relation_type": relation_type, "strength": new_strength}
        else:
            conn.execute(
                """
                INSERT INTO kg_relations
                  (source_id, target_id, relation_type, strength, created_at)
                VALUES (?,?,?,?,?)
                """,
                (source["id"], target["id"], relation_type, strength, ts),
            )
            conn.commit()
            return {"source": source_name, "target": target_name,
                    "relation_type": relation_type, "strength": strength}


# ── Leitura ──────────────────────────────────────────────────────────────────

def get_entity(name: str) -> Optional[dict]:
    row = _get_entity_by_name(name)
    return _entity_to_dict(row) if row else None


def get_neighbors(name: str, depth: int = 1) -> dict:
    """
    Retorna o subgrafo até N graus ao redor da entidade.
    Retorna: {entity, neighbors: [{entity, relation_type, strength, direction}]}
    """
    entity = _get_entity_by_name(name)
    if not entity:
        return {}

    visited = {entity["id"]}
    current_ids = {entity["id"]}
    all_edges = []
    all_entities = {entity["id"]: _entity_to_dict(entity)}

    for _ in range(depth):
        if not current_ids:
            break
        placeholders = ",".join("?" * len(current_ids))
        with get_db_connection() as conn:
            edges = conn.execute(
                f"""
                SELECT r.*, s.name AS s_name, t.name AS t_name
                FROM kg_relations r
                JOIN kg_entities s ON r.source_id = s.id
                JOIN kg_entities t ON r.target_id = t.id
                WHERE r.source_id IN ({placeholders}) OR r.target_id IN ({placeholders})
                """,
                list(current_ids) * 2,
            ).fetchall()

            next_ids = set()
            for edge in edges:
                peer_id = edge["target_id"] if edge["source_id"] in current_ids else edge["source_id"]
                if peer_id not in visited:
                    visited.add(peer_id)
                    next_ids.add(peer_id)
                    peer = conn.execute("SELECT * FROM kg_entities WHERE id=?", (peer_id,)).fetchone()
                    if peer:
                        all_entities[peer_id] = _entity_to_dict(peer)
                all_edges.append({
                    "source": edge["s_name"],
                    "target": edge["t_name"],
                    "relation_type": edge["relation_type"],
                    "strength": edge["strength"],
                })

            current_ids = next_ids

    return {
        "center": _entity_to_dict(entity),
        "entities": list(all_entities.values()),
        "edges": all_edges,
    }


def get_full_graph(limit: int = 200) -> dict:
    """Retorna o grafo completo para o Obsidian/BrainMap."""
    with get_db_connection() as conn:
        entities = conn.execute(
            "SELECT * FROM kg_entities ORDER BY importance DESC, access_count DESC LIMIT ?",
            (limit,),
        ).fetchall()

        entity_ids = [e["id"] for e in entities]
        if not entity_ids:
            return {"entities": [], "edges": []}

        placeholders = ",".join("?" * len(entity_ids))
        edges = conn.execute(
            f"""
            SELECT r.*, s.name AS s_name, t.name AS t_name
            FROM kg_relations r
            JOIN kg_entities s ON r.source_id = s.id
            JOIN kg_entities t ON r.target_id = t.id
            WHERE r.source_id IN ({placeholders}) AND r.target_id IN ({placeholders})
            ORDER BY r.strength DESC
            """,
            entity_ids * 2,
        ).fetchall()

    return {
        "entities": [_entity_to_dict(e) for e in entities],
        "edges": [
            {
                "source": e["s_name"],
                "target": e["t_name"],
                "relation_type": e["relation_type"],
                "strength": e["strength"],
            }
            for e in edges
        ],
    }


def get_entity_context(name: str) -> str:
    """Retorna texto formatado para injetar no prompt do LLM."""
    graph = get_neighbors(name, depth=2)
    if not graph:
        return ""

    center = graph["center"]
    lines = [
        f"Entidade: {center['name']} ({center['entity_type']})",
        f"Importância: {center['importance']:.2f}",
    ]
    if center.get("description"):
        lines.append(f"Descrição: {center['description']}")

    if graph["edges"]:
        lines.append("Relações:")
        for edge in graph["edges"][:10]:
            lines.append(f"  {edge['source']} --[{edge['relation_type']}]--> {edge['target']}")

    return "\n".join(lines)


def get_most_connected(limit: int = 20) -> list[dict]:
    """Entidades com mais relações — para destaque no Obsidian."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT e.*,
                   COUNT(DISTINCT r1.id) + COUNT(DISTINCT r2.id) AS connection_count
            FROM kg_entities e
            LEFT JOIN kg_relations r1 ON e.id = r1.source_id
            LEFT JOIN kg_relations r2 ON e.id = r2.target_id
            GROUP BY e.id
            ORDER BY connection_count DESC, e.importance DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def detect_and_register(text: str, session_id: Optional[str] = None) -> list[str]:
    """
    Detecta tecnologias/ferramentas no texto e registra automaticamente no grafo.
    Retorna lista de entidades detectadas.
    """
    found = []
    lower = text.lower()

    for tech, etype in KNOWN_TECHNOLOGIES.items():
        pattern = r"\b" + re.escape(tech) + r"\b"
        if re.search(pattern, lower):
            upsert_entity(tech, etype, importance=0.6)
            found.append(tech)

    # Relaciona tecnologias detectadas entre si (co-mencionadas)
    for i, a in enumerate(found):
        for b in found[i + 1:]:
            add_relation(a, b, "related_to", 0.4)

    return found


def get_stats() -> dict:
    with get_db_connection() as conn:
        entities = conn.execute("SELECT COUNT(*) as n FROM kg_entities").fetchone()["n"]
        relations = conn.execute("SELECT COUNT(*) as n FROM kg_relations").fetchone()["n"]
        top = conn.execute(
            "SELECT name, entity_type, importance FROM kg_entities ORDER BY importance DESC LIMIT 5"
        ).fetchall()
    return {
        "entities": entities,
        "relations": relations,
        "top_entities": [dict(r) for r in top],
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _get_entity_by_name(name: str):
    name_clean = _clean_name(name)
    with get_db_connection() as conn:
        return conn.execute(
            "SELECT * FROM kg_entities WHERE name=?", (name_clean,)
        ).fetchone()


def _entity_to_dict(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    d["metadata"] = json_loads(d.get("metadata") or "{}", fallback={})
    return d
