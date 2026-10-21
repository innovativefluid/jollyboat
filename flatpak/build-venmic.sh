#!/bin/sh
# Builds venmic (PipeWire screen-share audio, MPL-2.0) from source inside flatpak-builder. Its
# npm package ships prebuilt binaries; those are deleted and the addon is compiled against the
# runtime's PipeWire. CMake's package manager (CPM) gets every dependency from the checkouts the
# manifest placed in venmic-deps/, nothing is downloaded.
set -eu

deps="$PWD/venmic-deps"
cd node_modules/@vencord/venmic
rm -rf prebuilds build

../../.bin/cmake-js compile \
  --CDvenmic_addon=ON --CDvenmic_server=OFF \
  --CDCPM_SOURCE_CACHE="$deps" \
  --CDCPM_rohrkabel_SOURCE="$deps/rohrkabel" \
  --CDCPM_channel_SOURCE="$deps/channel" \
  --CDCPM_glaze_SOURCE="$deps/glaze" \
  --CDCPM_spdlog_SOURCE="$deps/spdlog" \
  --CDCPM_coco_SOURCE="$deps/coco" \
  --CDCPM_ereignis_SOURCE="$deps/ereignis" \
  --CDCPM_PackageProject_SOURCE="$deps/PackageProject" \
  -p "${FLATPAK_BUILDER_N_JOBS:-4}"

# keep the addon, drop the build tree
mv build/Release/venmic-addon.node venmic-addon.node
rm -rf build
mkdir -p build/Release
mv venmic-addon.node build/Release/
