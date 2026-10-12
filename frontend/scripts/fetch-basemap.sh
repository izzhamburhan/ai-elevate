#!/usr/bin/env bash
# Downloads the self-hosted vector basemap into public/basemap (npm run basemap):
#   malaysia.pmtiles  Protomaps' OpenStreetMap tiles, cut to Malaysia and its neighbours' borders
#   fonts/, sprites/  the label glyphs and POI icons the Protomaps styles draw with
# The app falls back to OpenStreetMap's raster tiles until these files exist.
# Set BASEMAP_BUILD to a build name (e.g. 20261012) to pin one; the default is the newest.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=public/basemap
# Peninsular Malaysia, Sabah and Sarawak, with Singapore, Brunei and the Thai and Indonesian borders
BBOX="99.0,0.5,120.0,7.6"
PMTILES_VERSION=1.31.2
ASSETS_URL=https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) CLI="go-pmtiles-${PMTILES_VERSION}_Darwin_arm64.zip" ;;
  Darwin-x86_64) CLI="go-pmtiles-${PMTILES_VERSION}_Darwin_x86_64.zip" ;;
  Linux-aarch64 | Linux-arm64) CLI="go-pmtiles_${PMTILES_VERSION}_Linux_arm64.tar.gz" ;;
  Linux-x86_64) CLI="go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" ;;
  *) echo "No pmtiles CLI for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

echo "Downloading the pmtiles CLI ${PMTILES_VERSION}"
curl -fsSL -o "$TMP/$CLI" "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${CLI}"
case "$CLI" in
  *.zip) unzip -q "$TMP/$CLI" pmtiles -d "$TMP" ;;
  *) tar -xzf "$TMP/$CLI" -C "$TMP" pmtiles ;;
esac

BUILD=${BASEMAP_BUILD:-$(curl -fsSL https://build-metadata.protomaps.dev/builds.json |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);console.log(b[b.length-1].key.replace(".pmtiles",""))})')}

mkdir -p "$OUT"
echo "Extracting Malaysia from Protomaps build ${BUILD} (about 500 MB)"
"$TMP/pmtiles" extract "https://build.protomaps.com/${BUILD}.pmtiles" "$TMP/malaysia.pmtiles" --bbox="$BBOX"
mv "$TMP/malaysia.pmtiles" "$OUT/malaysia.pmtiles"

echo "Downloading fonts and sprites"
curl -fsSL -o "$TMP/assets.tar.gz" "$ASSETS_URL"
tar -xzf "$TMP/assets.tar.gz" -C "$TMP"
rm -rf "$OUT/fonts" "$OUT/sprites"
mkdir -p "$OUT/fonts" "$OUT/sprites"
for font in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  cp -R "$TMP/basemaps-assets-main/fonts/$font" "$OUT/fonts/"
done
cp "$TMP/basemaps-assets-main/fonts/OFL.txt" "$OUT/fonts/"
cp "$TMP"/basemaps-assets-main/sprites/v4/{light,dark}{,@2x}.{json,png} "$OUT/sprites/"

echo "Basemap ready in $OUT (build ${BUILD})"
