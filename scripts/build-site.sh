#!/usr/bin/env bash
# Builds the published website into one folder (default: _site).
#   The Nines (club 1) = the site files at the root, as they are in this repo.
#   Every other club   = a folder named after clubs/<slug>/ (for example /lesronds/) holding the same
#                        pages and scripts, with that club's club.js (id, name, language) and logo.
# GitHub runs this on every merge to main (.github/workflows/publish.yml) and publishes the result.
# To preview locally: bash scripts/build-site.sh && python3 -m http.server -d _site 8000
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
SHARED=(index.html login.html members js css)

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "${SHARED[@]}" favicon.png favicon.ico favicon-180.png .nojekyll "$OUT"/
[ -f CNAME ] && cp CNAME "$OUT"/

for dir in clubs/*/; do
  slug="$(basename "$dir")"
  [[ "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "Skipping clubs/$slug: folder names use a-z, 0-9 and - only" >&2; continue; }
  [ -f "$dir/club.js" ] || { echo "Skipping clubs/$slug: no club.js" >&2; continue; }
  mkdir -p "$OUT/$slug"
  cp -R "${SHARED[@]}" "$OUT/$slug"/
  cp "$dir/club.js" "$OUT/$slug/js/club.js"
  for icon in favicon.png favicon.ico favicon-180.png; do
    if [ -f "$dir/$icon" ]; then cp "$dir/$icon" "$OUT/$slug/$icon"; else cp "$icon" "$OUT/$slug/$icon"; fi
  done
  echo "Built /$slug/"
done
echo "Site built in $OUT"
