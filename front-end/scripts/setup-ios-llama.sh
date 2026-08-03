#!/bin/bash
set -euo pipefail

AETHER_LLAMA_VERSION="b10242"
AETHER_LLAMA_SHA256="d7184d918043d25807ce9b08d1c676b0602107bccab90fd15c94669c782e5237"
AETHER_LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${AETHER_LLAMA_VERSION}/llama-${AETHER_LLAMA_VERSION}-xcframework.zip"
AETHER_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AETHER_FRONTEND_DIR="$(cd "${AETHER_SCRIPT_DIR}/.." && pwd)"
AETHER_VENDOR_DIR="${AETHER_FRONTEND_DIR}/ios/App/AetherNativeRuntime/Vendor"
AETHER_FRAMEWORK_DIR="${AETHER_VENDOR_DIR}/llama.xcframework"

if [ -d "${AETHER_FRAMEWORK_DIR}" ]; then
  echo "llama.cpp ${AETHER_LLAMA_VERSION} já está preparado para iOS."
  exit 0
fi

AETHER_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${AETHER_TMP_DIR}"' EXIT
AETHER_ARCHIVE="${AETHER_TMP_DIR}/llama-xcframework.zip"
AETHER_UNPACKED="${AETHER_TMP_DIR}/unpacked"

echo "Baixando llama.cpp ${AETHER_LLAMA_VERSION} para iOS..."
curl -L --fail --progress-bar -o "${AETHER_ARCHIVE}" "${AETHER_LLAMA_URL}"

echo "${AETHER_LLAMA_SHA256}  ${AETHER_ARCHIVE}" | shasum -a 256 -c -
mkdir -p "${AETHER_UNPACKED}" "${AETHER_VENDOR_DIR}"
ditto -x -k "${AETHER_ARCHIVE}" "${AETHER_UNPACKED}"
ditto "${AETHER_UNPACKED}/build-apple/llama.xcframework" "${AETHER_FRAMEWORK_DIR}"

echo "Runtime llama.cpp pronto em ${AETHER_FRAMEWORK_DIR}."
