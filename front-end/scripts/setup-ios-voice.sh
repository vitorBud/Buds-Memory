#!/bin/bash
set -euo pipefail

BUDS_SHERPA_VERSION="1.13.2"
BUDS_SHERPA_SHA256="2886a04df4f8d5066c6c8b6e712278d65d7b60fc9e45990223df50262861d38b"
BUDS_SHERPA_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${BUDS_SHERPA_VERSION}/sherpa-onnx-v${BUDS_SHERPA_VERSION}-ios.tar.bz2"
BUDS_KOKORO_VERSION="v1_0"
BUDS_KOKORO_SHA256="75654a84864be26f345f020f4070c2c019e96dd1b7f9bf6e2ffd59efac6aa5a3"
BUDS_KOKORO_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-${BUDS_KOKORO_VERSION}.tar.bz2"
BUDS_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUDS_FRONTEND_DIR="$(cd "${BUDS_SCRIPT_DIR}/.." && pwd)"
BUDS_VENDOR_DIR="${BUDS_FRONTEND_DIR}/ios/App/BudsNativeRuntime/Vendor"
BUDS_RESOURCE_DIR="${BUDS_FRONTEND_DIR}/ios/App/BudsNativeRuntime/Sources/BudsNativeRuntime/Resources/Kokoro"
BUDS_SHERPA_FRAMEWORK="${BUDS_VENDOR_DIR}/SherpaOnnxC.xcframework"
BUDS_ORT_FRAMEWORK="${BUDS_VENDOR_DIR}/OnnxRuntimeC.xcframework"

BUDS_RUNTIME_READY=0
BUDS_MODEL_READY=0
if [ -d "${BUDS_SHERPA_FRAMEWORK}" ] && [ -d "${BUDS_ORT_FRAMEWORK}" ]; then
  BUDS_RUNTIME_READY=1
fi
if [ -f "${BUDS_RESOURCE_DIR}/model.int8.onnx" ] \
  && [ -f "${BUDS_RESOURCE_DIR}/voices.bin" ] \
  && [ -f "${BUDS_RESOURCE_DIR}/tokens.txt" ] \
  && [ -d "${BUDS_RESOURCE_DIR}/espeak-ng-data" ]; then
  BUDS_MODEL_READY=1
fi

if [ "${BUDS_RUNTIME_READY}" -eq 1 ] && [ "${BUDS_MODEL_READY}" -eq 1 ]; then
  echo "Voz neural Kokoro ${BUDS_KOKORO_VERSION} já está preparada para iOS."
  exit 0
fi

BUDS_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${BUDS_TMP_DIR}"' EXIT
mkdir -p "${BUDS_VENDOR_DIR}"

if [ "${BUDS_RUNTIME_READY}" -eq 0 ]; then
  BUDS_RUNTIME_ARCHIVE="${BUDS_TMP_DIR}/sherpa-ios.tar.bz2"
  BUDS_RUNTIME_UNPACKED="${BUDS_TMP_DIR}/sherpa-ios"
  BUDS_SHERPA_HEADERS="${BUDS_TMP_DIR}/sherpa-headers"

  echo "Baixando Sherpa-ONNX ${BUDS_SHERPA_VERSION} para iOS..."
  curl -L --fail --progress-bar -o "${BUDS_RUNTIME_ARCHIVE}" "${BUDS_SHERPA_URL}"
  echo "${BUDS_SHERPA_SHA256}  ${BUDS_RUNTIME_ARCHIVE}" | shasum -a 256 -c -
  mkdir -p "${BUDS_RUNTIME_UNPACKED}" "${BUDS_SHERPA_HEADERS}"
  tar -xjf "${BUDS_RUNTIME_ARCHIVE}" -C "${BUDS_RUNTIME_UNPACKED}"

  BUDS_SHERPA_SOURCE="${BUDS_RUNTIME_UNPACKED}/build-ios/sherpa-onnx.xcframework"
  BUDS_ORT_SOURCE="${BUDS_RUNTIME_UNPACKED}/build-ios/ios-onnxruntime/1.17.1/onnxruntime.xcframework"
  cp "${BUDS_SHERPA_SOURCE}/ios-arm64/Headers/sherpa-onnx/c-api/c-api.h" "${BUDS_SHERPA_HEADERS}/c-api.h"
  cp "${BUDS_FRONTEND_DIR}/ios-modulemaps/SherpaOnnxC.modulemap" "${BUDS_SHERPA_HEADERS}/module.modulemap"

  rm -rf "${BUDS_SHERPA_FRAMEWORK}" "${BUDS_ORT_FRAMEWORK}"
  xcodebuild -create-xcframework \
    -library "${BUDS_SHERPA_SOURCE}/ios-arm64/libsherpa-onnx.a" -headers "${BUDS_SHERPA_HEADERS}" \
    -library "${BUDS_SHERPA_SOURCE}/ios-arm64_x86_64-simulator/libsherpa-onnx.a" -headers "${BUDS_SHERPA_HEADERS}" \
    -output "${BUDS_SHERPA_FRAMEWORK}"
  xcodebuild -create-xcframework \
    -library "${BUDS_ORT_SOURCE}/ios-arm64/onnxruntime.a" \
    -library "${BUDS_ORT_SOURCE}/ios-arm64_x86_64-simulator/onnxruntime.a" \
    -output "${BUDS_ORT_FRAMEWORK}"
fi

if [ "${BUDS_MODEL_READY}" -eq 0 ]; then
  BUDS_MODEL_ARCHIVE="${BUDS_TMP_DIR}/kokoro-int8.tar.bz2"
  BUDS_MODEL_UNPACKED="${BUDS_TMP_DIR}/kokoro-int8"

  echo "Baixando Kokoro INT8 com a voz brasileira pf_dora..."
  curl -L --fail --progress-bar -o "${BUDS_MODEL_ARCHIVE}" "${BUDS_KOKORO_URL}"
  echo "${BUDS_KOKORO_SHA256}  ${BUDS_MODEL_ARCHIVE}" | shasum -a 256 -c -
  mkdir -p "${BUDS_MODEL_UNPACKED}"
  tar -xjf "${BUDS_MODEL_ARCHIVE}" -C "${BUDS_MODEL_UNPACKED}"
  BUDS_MODEL_SOURCE="${BUDS_MODEL_UNPACKED}/kokoro-int8-multi-lang-${BUDS_KOKORO_VERSION}"

  rm -rf "${BUDS_RESOURCE_DIR}"
  mkdir -p "${BUDS_RESOURCE_DIR}"
  cp "${BUDS_MODEL_SOURCE}/model.int8.onnx" "${BUDS_RESOURCE_DIR}/model.int8.onnx"
  cp "${BUDS_MODEL_SOURCE}/voices.bin" "${BUDS_RESOURCE_DIR}/voices.bin"
  cp "${BUDS_MODEL_SOURCE}/tokens.txt" "${BUDS_RESOURCE_DIR}/tokens.txt"
  ditto "${BUDS_MODEL_SOURCE}/espeak-ng-data" "${BUDS_RESOURCE_DIR}/espeak-ng-data"
  cp "${BUDS_MODEL_SOURCE}/LICENSE" "${BUDS_RESOURCE_DIR}/LICENSE"
fi

echo "Voz neural feminina pf_dora pronta para iOS."
