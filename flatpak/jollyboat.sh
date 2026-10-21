#!/bin/sh
# Flatpak launcher. Electron keeps its single-instance lock in TMPDIR, which has to be the same
# for every start of the app, so it gets the per-app runtime dir.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/jollyboat/jollyboat "$@"
