"""
llm/web_search.py — Busca web via Google Custom Search API.

Extraído de agenty.py para isolar a integração com serviços externos.

Exporta:
  GOOGLE_API_KEY, GOOGLE_CSE_ID
  is_google_search_configured()
  search_google(query, num_results)
  format_web_context(results)
  get_google_error_message()
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import requests

_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID  = os.getenv("GOOGLE_CSE_ID",  "")


def is_google_search_configured() -> bool:
    """Retorna True se as credenciais de busca estiverem configuradas."""
    return bool(GOOGLE_API_KEY and GOOGLE_CSE_ID)


def get_google_error_message() -> str:
    if not GOOGLE_API_KEY:
        return "Google API Key não configurada (.env: GOOGLE_API_KEY)."
    if not GOOGLE_CSE_ID:
        return "Google CSE ID não configurado (.env: GOOGLE_CSE_ID)."
    return "Busca Google não configurada."


def search_google(query: str, num_results: int = 5) -> list[dict]:
    """
    Executa busca via Google Custom Search API.

    Retorna lista de dicts com title, snippet, link.
    Retorna lista vazia se a busca não estiver configurada ou falhar.
    """
    if not is_google_search_configured():
        return []

    try:
        response = requests.get(
            GOOGLE_SEARCH_URL,
            params={
                "key": GOOGLE_API_KEY,
                "cx":  GOOGLE_CSE_ID,
                "q":   query,
                "num": num_results,
                "lr":  "lang_pt",
            },
            timeout=6,
        )
        if response.status_code != 200:
            return []

        items = response.json().get("items") or []
        return [
            {
                "title":   item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "link":    item.get("link", ""),
            }
            for item in items
        ]
    except Exception as exc:
        print(f"[WebSearch] Erro ao buscar: {exc}")
        return []


def format_web_context(results: list[dict], max_chars: int = 3200) -> str:
    """
    Formata resultados de busca como bloco de contexto para o prompt.

    Cada resultado inclui título, link e snippet.
    """
    if not results:
        return ""

    lines = ["Resultados recentes da web:"]
    total = 0
    for idx, result in enumerate(results, start=1):
        title   = (result.get("title") or "").strip()
        snippet = (result.get("snippet") or "").strip()
        link    = (result.get("link") or "").strip()
        block   = f"{idx}. {title}\n{snippet}\nFonte: {link}"
        if total + len(block) > max_chars:
            break
        lines.append(block)
        total += len(block)

    return "\n\n".join(lines)
