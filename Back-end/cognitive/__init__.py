"""
cognitive/ — Camada cognitiva do Buds Memory (Second Brain).

Garante que o diretório Back-end/ esteja no sys.path para que os
sub-módulos possam importar database_v2 e agenty diretamente,
independente do diretório de trabalho atual ou do interpretador da IDE.
"""

import sys
from pathlib import Path

# Adiciona o diretório pai (Back-end/) ao sys.path
_BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
