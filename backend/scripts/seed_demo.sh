#!/usr/bin/env bash
# Usage: backend/scripts/seed_demo.sh [local|cloud|index]   (default local). See seed_demo.py.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/aws-cli/v2/current/bin:$PATH"
cd "$(dirname "$0")/../.."
python3 backend/scripts/make_transcripts.py demo
exec python3 backend/scripts/seed_demo.py "${1:-local}"
