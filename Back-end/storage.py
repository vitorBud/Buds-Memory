"""
storage.py - caminhos persistentes do Aether Memory.

No desenvolvimento, os dados continuam na pasta Back-end. No app desktop,
o Electron define NEXUS_DATA_DIR para salvar banco e audios em Application
Support, sem prender os dados na pasta do projeto.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
APP_NAME = "Aether Memory"


def get_data_dir() -> Path:
    configured = os.getenv("NEXUS_DATA_DIR")
    if configured:
        data_dir = Path(configured).expanduser()
    else:
        data_dir = BASE

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_database_path() -> Path:
    data_dir = get_data_dir()
    db_path = data_dir / "chat_history.db"
    _copy_legacy_database(db_path)
    return db_path


def get_output_dir() -> Path:
    out_dir = get_data_dir() / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def get_env_path() -> Path:
    return get_data_dir() / ".env"


def _copy_legacy_database(target_db: Path):
    legacy_db = BASE / "chat_history.db"
    if target_db == legacy_db or target_db.exists() or not legacy_db.exists():
        return

    target_db.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        source = Path(f"{legacy_db}{suffix}")
        target = Path(f"{target_db}{suffix}")
        if source.exists() and not target.exists():
            shutil.copy2(source, target)
