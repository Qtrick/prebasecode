#!/usr/bin/env bash
# Prune regenerable pen.dev preview/archive media to save disk.
# Does not delete .pen/.json (throwaway design copies in archive/ stay until removed manually).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
removed=0
for dir in "$ROOT/previews" "$ROOT/archive"; do
  mkdir -p "$dir"
  while IFS= read -r -d '' f; do
    rm -f "$f"
    removed=$((removed + 1))
  done < <(find "$dir" -type f \( \
    -iname '*.png' -o -iname '*.jpeg' -o -iname '*.jpg' \
    -o -iname '*.webp' -o -iname '*.pdf' -o -iname '*.tmp' \
  \) -print0 2>/dev/null || true)
  echo "cleared regenerable media under $dir"
done
echo "gc done; removed $removed files. Re-export previews with pen --export when needed."
