"""
cognitive/codebase_indexer.py — Indexador local de codebases do Buds Memory.

Cria um índice estrutural leve de projetos React/Python/Node/etc. sem depender
de serviços externos. O objetivo é permitir perguntas como "onde está login?"
ou "quais rotas existem?" usando a tabela codebase_index.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from database_v2 import get_db_connection, now_iso, json_dumps, json_loads


SUPPORTED_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".html", ".md", ".sql", ".yml", ".yaml",
}

IGNORED_DIRS = {
    ".git", "node_modules", "dist", "build", "release", ".venv", "venv", "ambiente",
    "__pycache__", ".next", ".turbo", ".cache", "coverage",
}

MAX_FILE_BYTES = 320_000


def index_codebase(project_root: str, max_files: int = 900) -> dict:
    """Indexa uma pasta local e substitui o índice antigo daquele root."""
    root = Path(project_root).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"Pasta inválida: {project_root}")

    with get_db_connection() as conn:
        conn.execute("DELETE FROM codebase_index WHERE project_root=?", (str(root),))
        conn.commit()

    rows = []
    scanned = 0
    skipped = 0

    for path in _iter_files(root):
        if scanned >= max_files:
            break
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                skipped += 1
                continue
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            skipped += 1
            continue

        scanned += 1
        relative = str(path.relative_to(root))
        analysis = analyze_file(relative, content)
        rows.extend(_rows_for_file(str(root), relative, path.name, content, analysis))

    with get_db_connection() as conn:
        conn.executemany(
            """
            INSERT INTO codebase_index
              (project_root, relative_path, file_name, language, kind, symbol_name, signature,
               imports, dependencies, routes, hooks, classes, functions, summary, content, metadata, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()

    return {
        "project_root": str(root),
        "files_scanned": scanned,
        "files_skipped": skipped,
        "records_indexed": len(rows),
    }


def search_codebase(query: str, project_root: Optional[str] = None, limit: int = 12) -> list[dict]:
    """Busca textual/estrutural no índice de codebase."""
    tokens = _tokenize(query)
    if not tokens:
        return []

    params = []
    where = ""
    if project_root:
        where = "WHERE project_root=?"
        params.append(str(Path(project_root).expanduser().resolve()))

    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM codebase_index {where} ORDER BY indexed_at DESC LIMIT 5000",
            params,
        ).fetchall()

    scored = []
    for row in rows:
        haystack = " ".join(str(row[key] or "") for key in (
            "relative_path", "file_name", "language", "kind", "symbol_name", "signature",
            "imports", "dependencies", "routes", "hooks", "classes", "functions", "summary", "content",
        )).lower()
        score = 0.0
        for token in tokens:
            score += haystack.count(token)
            if token and token == str(row["symbol_name"] or "").lower():
                score += 8
            if token and token in str(row["relative_path"] or "").lower():
                score += 3
        if score > 0:
            item = dict(row)
            item["score"] = round(score, 3)
            item["imports"] = json_loads(item.get("imports") or "[]", fallback=[])
            item["dependencies"] = json_loads(item.get("dependencies") or "[]", fallback=[])
            item["routes"] = json_loads(item.get("routes") or "[]", fallback=[])
            item["hooks"] = json_loads(item.get("hooks") or "[]", fallback=[])
            item["classes"] = json_loads(item.get("classes") or "[]", fallback=[])
            item["functions"] = json_loads(item.get("functions") or "[]", fallback=[])
            item["metadata"] = json_loads(item.get("metadata") or "{}", fallback={})
            scored.append(item)

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


def get_stats() -> dict:
    """Retorna estatísticas rápidas do índice de codebase."""
    with get_db_connection() as conn:
        try:
            total = conn.execute("SELECT COUNT(*) AS n FROM codebase_index").fetchone()["n"]
            projects = conn.execute("SELECT COUNT(DISTINCT project_root) AS n FROM codebase_index").fetchone()["n"]
            symbols = conn.execute(
                "SELECT COUNT(*) AS n FROM codebase_index WHERE symbol_name IS NOT NULL AND symbol_name != ''"
            ).fetchone()["n"]
            by_language = conn.execute(
                "SELECT language, COUNT(*) AS n FROM codebase_index GROUP BY language ORDER BY n DESC LIMIT 8"
            ).fetchall()
        except Exception:
            return {"total_rows": 0, "projects": 0, "symbols": 0, "by_language": {}}

    return {
        "total_rows": total,
        "projects": projects,
        "symbols": symbols,
        "by_language": {row["language"] or "texto": row["n"] for row in by_language},
    }


def analyze_file(relative_path: str, content: str) -> dict:
    """Extrai metadados estruturais de um arquivo."""
    ext = Path(relative_path).suffix.lower()
    language = _language_from_ext(ext)
    imports = _extract_imports(content, language)
    functions = _extract_functions(content, language)
    classes = _extract_classes(content, language)
    hooks = sorted(set(re.findall(r"\b(use[A-Z]\w+)\s*\(", content)))[:30]
    routes = _extract_routes(content)
    dependencies = _extract_dependencies(relative_path, content)

    return {
        "language": language,
        "imports": imports,
        "functions": functions,
        "classes": classes,
        "hooks": hooks,
        "routes": routes,
        "dependencies": dependencies,
        "summary": _summarize_file(relative_path, language, functions, classes, routes, imports),
    }


def _iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        yield path


def _rows_for_file(project_root: str, relative: str, file_name: str, content: str, analysis: dict):
    indexed_at = now_iso()
    compact_content = content[:6000]
    common = (
        project_root,
        relative,
        file_name,
        analysis["language"],
        None,
        None,
        json_dumps(analysis["imports"]),
        json_dumps(analysis["dependencies"]),
        json_dumps(analysis["routes"]),
        json_dumps(analysis["hooks"]),
        json_dumps(analysis["classes"]),
        json_dumps(analysis["functions"]),
        analysis["summary"],
        compact_content,
        json_dumps({"line_count": content.count("\n") + 1}),
        indexed_at,
    )
    rows = [(*common[:4], "file", *common[4:])]

    for kind, symbols in (("function", analysis["functions"]), ("class", analysis["classes"]), ("route", analysis["routes"]), ("hook", analysis["hooks"])):
        for symbol in symbols[:40]:
            rows.append((
                project_root, relative, file_name, analysis["language"], kind, symbol,
                _find_signature(symbol, content), json_dumps(analysis["imports"]),
                json_dumps(analysis["dependencies"]), json_dumps(analysis["routes"]),
                json_dumps(analysis["hooks"]), json_dumps(analysis["classes"]),
                json_dumps(analysis["functions"]), analysis["summary"], compact_content,
                json_dumps({"symbol": symbol}), indexed_at,
            ))
    return rows


def _language_from_ext(ext: str) -> str:
    return {
        ".py": "python", ".js": "javascript", ".jsx": "react", ".ts": "typescript",
        ".tsx": "react", ".json": "json", ".css": "css", ".html": "html",
        ".md": "markdown", ".sql": "sql", ".yml": "yaml", ".yaml": "yaml",
    }.get(ext, "text")


def _extract_imports(content: str, language: str) -> list[str]:
    imports = set()
    if language == "python":
        for match in re.finditer(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", content, re.M):
            imports.add(next(group for group in match.groups() if group))
    else:
        patterns = [
            r"import\s+.*?\s+from\s+['\"]([^'\"]+)['\"]",
            r"import\s+['\"]([^'\"]+)['\"]",
            r"require\(['\"]([^'\"]+)['\"]\)",
        ]
        for pattern in patterns:
            imports.update(re.findall(pattern, content))
    return sorted(imports)[:80]


def _extract_functions(content: str, language: str) -> list[str]:
    names = set()
    if language == "python":
        names.update(re.findall(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", content, re.M))
    else:
        patterns = [
            r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(",
            r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>",
            r"\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>",
            r"\bexport\s+function\s+([A-Za-z_$][\w$]*)\s*\(",
        ]
        for pattern in patterns:
            names.update(re.findall(pattern, content))
    return sorted(names)[:120]


def _extract_classes(content: str, language: str) -> list[str]:
    if language == "python":
        return sorted(set(re.findall(r"^\s*class\s+([A-Za-z_]\w*)", content, re.M)))[:80]
    return sorted(set(re.findall(r"\bclass\s+([A-Za-z_$][\w$]*)", content)))[:80]


def _extract_routes(content: str) -> list[str]:
    routes = set()
    patterns = [
        r"@\w+\.route\(['\"]([^'\"]+)['\"]",
        r"@\w+\.(?:get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]",
        r"\bapp\.(?:get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]",
        r"\brouter\.(?:get|post|put|delete|patch)\(['\"]([^'\"]+)['\"]",
        r"\bpath\s*[:=]\s*['\"]([^'\"]+)['\"]",
    ]
    for pattern in patterns:
        routes.update(re.findall(pattern, content))
    return sorted(routes)[:80]


def _extract_dependencies(relative_path: str, content: str) -> list[str]:
    if Path(relative_path).name != "package.json":
        return []
    try:
        data = json.loads(content)
        deps = list((data.get("dependencies") or {}).keys())
        deps.extend((data.get("devDependencies") or {}).keys())
        return sorted(set(deps))[:200]
    except Exception:
        return []


def _summarize_file(relative_path: str, language: str, functions: list[str], classes: list[str], routes: list[str], imports: list[str]) -> str:
    parts = [f"Arquivo {relative_path} ({language})"]
    if classes:
        parts.append(f"classes: {', '.join(classes[:6])}")
    if functions:
        parts.append(f"funções: {', '.join(functions[:8])}")
    if routes:
        parts.append(f"rotas: {', '.join(routes[:6])}")
    if imports:
        parts.append(f"imports: {', '.join(imports[:6])}")
    return " · ".join(parts)


def _find_signature(symbol: str, content: str) -> str:
    escaped = re.escape(symbol)
    for line in content.splitlines():
        if re.search(rf"\b{escaped}\b", line):
            return line.strip()[:220]
    return symbol


def _tokenize(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s./_-]", " ", (text or "").lower())
    return [word for word in clean.split() if len(word) > 1]
