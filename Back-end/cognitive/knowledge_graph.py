"""
cognitive/knowledge_graph.py — Grafo de Conhecimento do Buds Memory.

Representa entidades (tecnologias, projetos, conceitos, pessoas, eventos)
e relações entre elas, armazenado em tabelas de adjacência no SQLite.

Exemplo:
  React ─[uses]→ useState
  Buds Memory ─[part_of]→ Python
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
    "usa", "implementa", "depende_de", "faz_parte_de", "criado_em",
    "aprendido_em", "documentado_em", "mencionado_em",
}

RELATION_ALIASES = {
    "uses": "usa",
    "use": "usa",
    "utiliza": "usa",
    "part_of": "faz_parte_de",
    "depends_on": "depende_de",
    "depends": "depende_de",
    "implements": "implementa",
    "learned_in": "aprendido_em",
    "created": "criado_em",
    "mentions": "mencionado_em",
}

# ── Limiar de exibição no grafo ────────────────────────────────────
MIN_ENTITY_IMPORTANCE = 0.5  # entidades abaixo disso ficam em observação
MIN_ENTITY_MENTIONS   = 1    # access_count mínimo para aparecer no grafo

# ── Detecção automática de tecnologias ──────────────────────────────────────
KNOWN_TECHNOLOGIES: dict[str, str] = {
    "python": "technology", "javascript": "technology", "typescript": "technology",
    "react": "library", "vue": "library", "angular": "library", "svelte": "library",
    "next.js": "library", "nextjs": "library", "vite": "tool",
    "flask": "library", "django": "library", "fastapi": "library",
    "node": "technology", "nodejs": "technology", "node.js": "technology",
    "postgresql": "technology", "sqlite": "technology", "mysql": "technology",
    "mongodb": "technology", "firebase": "tool",
    "docker": "tool", "git": "tool", "github": "tool",
    "ollama": "tool", "whisper": "tool", "piper": "tool",
    "three.js": "library", "framer": "library", "tailwind": "library",
    "css": "technology", "html": "technology", "sql": "technology",
    "numpy": "library", "pandas": "library", "scikit-learn": "library",
    "openai": "tool", "langchain": "library",
}

# ── Mapa de normalização / consolidação de aliases ───────────────────────
_ALIAS_MAP: dict[str, str] = {
    "js": "javascript", "javascript es6": "javascript", "vanillajs": "javascript",
    "ts": "typescript", "reactjs": "react", "react.js": "react", "react js": "react",
    "next": "next.js", "nextjs": "next.js", "next js": "next.js",
    "node": "node.js", "nodejs": "node.js", "node js": "node.js",
    "vuejs": "vue", "vue.js": "vue", "vue js": "vue", "py": "python",
    "sqlite3": "sqlite", "postgres": "postgresql", "pg": "postgresql",
    "flask api": "flask", "flask rest": "flask", "tailwindcss": "tailwind",
    "tailwind css": "tailwind",
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
                VALUES (?,?,?,?,1,?,?,?)
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
    relation_type = _normalize_relation_type(relation_type)

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
    """
    Retorna o grafo filtrado para o Obsidian/BrainMap.

    Só inclui entidades com:
      - importance >= MIN_ENTITY_IMPORTANCE (padrão 0.5)
      - access_count >= MIN_ENTITY_MENTIONS (padrão 1)
    Isso garante que tecnologias mencionadas uma única vez fiquem em
    observação e não poluam o grafo.
    """
    with get_db_connection() as conn:
        entities = conn.execute(
            """
            SELECT * FROM kg_entities
            WHERE importance >= ? AND access_count >= ?
            ORDER BY importance DESC, access_count DESC
            LIMIT ?
            """,
            (MIN_ENTITY_IMPORTANCE, MIN_ENTITY_MENTIONS, limit),
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
    Detecta tecnologias no texto e registra no grafo.

    Primeira detecção: importance=0.35 (abaixo do limiar de exibição).
    Cada menção adicional incrementa +0.1, até 1.0.
    Quando importance >= MIN_ENTITY_IMPORTANCE, a entidade passa a aparecer
    no grafo do Obsidian.
    """
    found: list[str] = []
    lower = text.lower()

    for tech, etype in KNOWN_TECHNOLOGIES.items():
        # Resolve alias para nome canônico
        canonical = _ALIAS_MAP.get(tech, tech)
        pattern = r"\b" + re.escape(tech) + r"\b"
        if re.search(pattern, lower):
            # Verifica se já existe com importância acima do limiar
            existing = _get_entity_by_name(canonical)
            if existing:
                # Reforça a importância (+0.1 por menção)
                new_imp = min(existing["importance"] + 0.1, 1.0)
                upsert_entity(canonical, etype, importance=new_imp)
            else:
                # Primeira detecção: fica em observação (0.35, abaixo do limiar)
                upsert_entity(canonical, etype, importance=0.35)
            if canonical not in found:
                found.append(canonical)

    relation_type = _infer_relation_type(lower)

    # Relaciona tecnologias co-mencionadas entre si.
    # Quando há pista textual, evita usar apenas related_to.
    for i, a in enumerate(found):
        for b in found[i + 1:]:
            add_relation(a, b, relation_type, 0.45 if relation_type != "related_to" else 0.4)

    return found


def consolidate_duplicates() -> dict:
    """
    Consolida entidades duplicadas/aliases no grafo.

    Exemplo: 'reactjs', 'react.js', 'react js' → todos viram 'react'.
    Transfere as relações para o nó canônico e remove os aliases.
    """
    merged = 0
    with get_db_connection() as conn:
        for alias, canonical in _ALIAS_MAP.items():
            alias_row = conn.execute(
                "SELECT id FROM kg_entities WHERE name=?", (alias,)
            ).fetchone()
            canonical_row = conn.execute(
                "SELECT id FROM kg_entities WHERE name=?", (canonical,)
            ).fetchone()

            if not alias_row or not canonical_row:
                continue

            alias_id     = alias_row["id"]
            canonical_id = canonical_row["id"]

            # Redireciona relações do alias para o nó canônico
            conn.execute(
                "UPDATE kg_relations SET source_id=? WHERE source_id=?",
                (canonical_id, alias_id),
            )
            conn.execute(
                "UPDATE kg_relations SET target_id=? WHERE target_id=?",
                (canonical_id, alias_id),
            )
            # Remove self-loops gerados
            conn.execute(
                "DELETE FROM kg_relations WHERE source_id=target_id"
            )
            # Remove entidade alias
            conn.execute("DELETE FROM kg_entities WHERE id=?", (alias_id,))
            conn.commit()
            merged += 1

    return {"aliases_merged": merged}


def get_communities(limit: int = 200) -> list[dict]:
    """
    Agrupa entidades conectadas em comunidades leves.

    É uma versão local-first inspirada no GraphRAG: usa componentes conectados
    do grafo em SQLite, sem dependências pesadas de community detection.
    """
    graph = get_full_graph(limit=limit)
    entities = graph.get("entities", [])
    edges = graph.get("edges", [])
    if not entities:
        return []

    by_name = {entity["name"]: entity for entity in entities}
    adjacency: dict[str, set[str]] = {name: set() for name in by_name}
    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        if source in adjacency and target in adjacency:
            adjacency[source].add(target)
            adjacency[target].add(source)

    visited = set()
    communities = []
    for name in by_name:
        if name in visited:
            continue
        stack = [name]
        component = []
        visited.add(name)
        while stack:
            current = stack.pop()
            component.append(by_name[current])
            for neighbor in adjacency.get(current, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)

        component.sort(key=lambda item: (item.get("importance", 0), item.get("access_count", 0)), reverse=True)
        component_names = {item["name"] for item in component}
        component_edges = [
            edge for edge in edges
            if edge["source"] in component_names and edge["target"] in component_names
        ]
        communities.append({
            "id": f"community_{len(communities) + 1}",
            "title": component[0]["name"] if component else "comunidade",
            "summary": _summarize_community(component, component_edges),
            "entities": component[:24],
            "edges": component_edges[:40],
            "size": len(component),
            "edge_count": len(component_edges),
            "importance": round(sum(float(item.get("importance") or 0.0) for item in component) / max(1, len(component)), 3),
        })

    communities.sort(key=lambda item: (item["size"], item["importance"], item["edge_count"]), reverse=True)
    return communities


def search_communities(query: str, limit: int = 4) -> list[dict]:
    tokens = _tokenize(query)
    if not tokens:
        return get_communities(limit=limit)[:limit]

    scored = []
    for community in get_communities():
        haystack = " ".join([
            community.get("title", ""),
            community.get("summary", ""),
            " ".join(entity.get("name", "") for entity in community.get("entities", [])),
        ]).lower()
        score = sum(haystack.count(token) for token in tokens)
        if score > 0:
            item = dict(community)
            item["score"] = score
            scored.append(item)

    scored.sort(key=lambda item: (item["score"], item["importance"], item["size"]), reverse=True)
    return scored[:limit]


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
        "communities": len(get_communities(limit=200)),
        "top_entities": [dict(r) for r in top],
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _clean_name(name: str) -> str:
    clean = re.sub(r"\s+", " ", (name or "").strip()).lower()
    return _ALIAS_MAP.get(clean, clean)


def _normalize_relation_type(relation_type: str) -> str:
    clean = (relation_type or "related_to").strip().lower()
    clean = RELATION_ALIASES.get(clean, clean)
    return clean if clean in RELATION_TYPES else "related_to"


def _infer_relation_type(text: str) -> str:
    if re.search(r"\b(depende|dependencia|dependência|requires?|require)\b", text):
        return "depende_de"
    if re.search(r"\b(implementa|implementando|implements?|built with)\b", text):
        return "implementa"
    if re.search(r"\b(usa|usar|usando|utiliza|utilizando|uses?)\b", text):
        return "usa"
    if re.search(r"\b(documenta|documentado|docs?|manual)\b", text):
        return "documentado_em"
    if re.search(r"\b(aprendi|aprendeu|aprendido|learned)\b", text):
        return "aprendido_em"
    if re.search(r"\b(menciona|mencionado|cita|mentions?)\b", text):
        return "mencionado_em"
    return "related_to"


def _summarize_community(entities: list[dict], edges: list[dict]) -> str:
    names = [entity["name"] for entity in entities[:8]]
    types = {}
    for entity in entities:
        types[entity.get("entity_type", "concept")] = types.get(entity.get("entity_type", "concept"), 0) + 1
    type_bits = ", ".join(f"{kind}: {count}" for kind, count in sorted(types.items(), key=lambda item: item[1], reverse=True)[:4])
    relation_bits = []
    for edge in edges[:5]:
        relation_bits.append(f"{edge['source']} -> {edge['target']} ({edge['relation_type']})")
    summary = f"Comunidade com {len(entities)} conceito(s): {', '.join(names)}."
    if type_bits:
        summary += f" Tipos: {type_bits}."
    if relation_bits:
        summary += " Relações principais: " + "; ".join(relation_bits) + "."
    return summary


def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s./_-]", " ", (text or "").lower())
    stop = {"para", "como", "qual", "quais", "sobre", "onde", "quando", "isso", "esse", "essa"}
    return [word for word in clean.split() if len(word) > 2 and word not in stop]


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
