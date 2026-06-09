#!/usr/bin/env zsh

# Inicia o backend usando o ambiente Python local do projeto.
cd "$(dirname "$0")"
source ambiente/bin/activate
python app.py
