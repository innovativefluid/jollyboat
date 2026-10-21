#!/bin/sh
# Regenerates flatpak/generated-sources.json (every npm package and electron, for the offline
# flatpak build) from package-lock.json. Run it after any dependency change.
# Needs python3 and git; the generator is installed into a throwaway venv.
set -eu
cd "$(dirname "$0")/.."
venv="${TMPDIR:-/tmp}/flatpak-node-generator"
[ -x "$venv/bin/flatpak-node-generator" ] || {
  python3 -m venv "$venv"
  "$venv/bin/pip" install -q "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
}
"$venv/bin/flatpak-node-generator" npm package-lock.json -o flatpak/generated-sources.json
