#!/bin/bash
# Download RIME dictionaries (rime-ice) for the Chinese pipeline.
# Run once before first use: ./scripts/download_dicts.sh

set -e

DICT_DIR="$(cd "$(dirname "$0")/.." && pwd)/dicts"
mkdir -p "$DICT_DIR"

REPO="https://github.com/iDvel/rime-ice"
FILES=(
    "base.dict.yaml"
    "ext.dict.yaml"
    "tencent.dict.yaml"
    "8105.dict.yaml"
)

echo "Downloading RIME dictionaries from rime-ice..."
for file in "${FILES[@]}"; do
    if [ -f "$DICT_DIR/$file" ]; then
        echo "  $file: already exists, skipping"
        continue
    fi
    echo "  $file: downloading..."
    curl -sL "$REPO/raw/main/$file" -o "$DICT_DIR/$file"
done

echo "Done. Dictionaries saved to $DICT_DIR"
