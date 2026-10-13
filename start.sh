#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "[VISH] Installing/checking local Python dependencies..."
python3 -m pip install -r requirements.txt
echo "[VISH] Starting at http://127.0.0.1:8000"
python3 run.py
