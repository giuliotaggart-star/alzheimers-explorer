#!/usr/bin/env bash
# Prepare the data film once it is saved as assets/video/data-journey.mp4 (Build Spec v5, "The data video").
#   1. makes the poster from the last frame
#   2. re-encodes for the web if the file is over 6 MB
# Then run: python3 notebook/validate_contract.py  and  node tests/acceptance.js
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/video/data-journey.mp4
[ -f "$SRC" ] || { echo "Missing $SRC: download the film from Higgsfield and save it there first."; exit 1; }
ffmpeg -y -sseof -0.1 -i "$SRC" -frames:v 1 -q:v 3 assets/video/data-journey.jpg
SIZE=$(wc -c < "$SRC")
if [ "$SIZE" -gt $((6 * 1024 * 1024)) ]; then
  ffmpeg -y -i "$SRC" -c:v libx264 -crf 26 -preset slow -movflags +faststart -c:a aac -b:a 96k /tmp/data-journey-web.mp4
  mv /tmp/data-journey-web.mp4 "$SRC"
fi
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$SRC"
echo "Now check each scene change against video.captions in data/seaad-mtg.json (six seconds per scene)."
