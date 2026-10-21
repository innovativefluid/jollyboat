#!/bin/sh
# Writes the files for the Flathub repository (flathub/net.innovativefluid.Jollyboat) for a
# released version: the manifest with the app source pinned to the git tag instead of this
# directory, and the offline npm sources.
# usage: tools/flathub-export.sh <version> <out dir>
set -eu
version=$1
out=$2
cd "$(dirname "$0")/.."

tag="v$version"
commit=$(git rev-parse "$tag^{commit}")
mkdir -p "$out"

# the app source: the dir block (from "# app-source" to the generated sources) becomes a git source
awk -v tag="$tag" -v commit="$commit" '
  /# app-source/ {
    print "      - type: git"
    print "        url: https://github.com/innovativefluid/jollyboat.git"
    print "        tag: " tag
    print "        commit: " commit
    skipping = 1; next
  }
  skipping && /# every npm package/ { skipping = 0 }
  !skipping { print }
' flatpak/net.innovativefluid.Jollyboat.yml > "$out/net.innovativefluid.Jollyboat.yml"

git show "$tag:flatpak/generated-sources.json" > "$out/generated-sources.json"
echo "wrote $out for $tag ($commit)"
