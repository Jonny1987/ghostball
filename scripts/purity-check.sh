#!/usr/bin/env bash
# CI purity guard: src/core must not import three, scene, ui, or debug code.
# (DOM *globals* in core are caught separately by src/core/tsconfig.json having no DOM lib.)
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -rE "from ['\"](three|\.\./scene|\.\./ui|\.\./debug)" src/core --include='*.ts'; then
  echo "PURITY VIOLATION: src/core imports a forbidden module (see matches above)" >&2
  exit 1
fi
echo "purity: src/core imports are clean"
