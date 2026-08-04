#!/bin/bash
set -euo pipefail

BUDS_LLAMA_VERSION="b10242"
BUDS_LLAMA_SHA256="d7184d918043d25807ce9b08d1c676b0602107bccab90fd15c94669c782e5237"
BUDS_LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${BUDS_LLAMA_VERSION}/llama-${BUDS_LLAMA_VERSION}-xcframework.zip"
BUDS_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUDS_FRONTEND_DIR="$(cd "${BUDS_SCRIPT_DIR}/.." && pwd)"
BUDS_VENDOR_DIR="${BUDS_FRONTEND_DIR}/ios/App/BudsNativeRuntime/Vendor"
BUDS_FRAMEWORK_DIR="${BUDS_VENDOR_DIR}/llama.xcframework"

if [ -d "${BUDS_FRAMEWORK_DIR}" ]; then
  echo "llama.cpp ${BUDS_LLAMA_VERSION} já está preparado para iOS."
  exit 0
fi

BUDS_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${BUDS_TMP_DIR}"' EXIT
BUDS_ARCHIVE="${BUDS_TMP_DIR}/llama-xcframework.zip"
BUDS_UNPACKED="${BUDS_TMP_DIR}/unpacked"

echo "Baixando llama.cpp ${BUDS_LLAMA_VERSION} para iOS..."
curl -L --fail --progress-bar -o "${BUDS_ARCHIVE}" "${BUDS_LLAMA_URL}"

echo "${BUDS_LLAMA_SHA256}  ${BUDS_ARCHIVE}" | shasum -a 256 -c -
mkdir -p "${BUDS_UNPACKED}" "${BUDS_VENDOR_DIR}"
ditto -x -k "${BUDS_ARCHIVE}" "${BUDS_UNPACKED}"
ditto "${BUDS_UNPACKED}/build-apple/llama.xcframework" "${BUDS_FRAMEWORK_DIR}"

echo "Runtime llama.cpp pronto em ${BUDS_FRAMEWORK_DIR}."
