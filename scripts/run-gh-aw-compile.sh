#!/usr/bin/env bash

set -euo pipefail

EXPECTED_GH_AW_VERSION="v0.69.0"

installed_version="$(
  gh extension list \
    | awk '$1 == "gh" && $2 == "aw" { print $4 }'
)"

if [[ -z "${installed_version}" ]]; then
  echo "gh-aw is not installed."
  echo "Install it with: gh extension install github/gh-aw --pin ${EXPECTED_GH_AW_VERSION} --force"
  exit 1
fi

if [[ "${installed_version}" != "${EXPECTED_GH_AW_VERSION}" ]]; then
  echo "gh-aw version mismatch: expected ${EXPECTED_GH_AW_VERSION}, found ${installed_version}."
  echo "Install the expected version with: gh extension install github/gh-aw --pin ${EXPECTED_GH_AW_VERSION} --force"
  exit 1
fi

gh aw compile "$@"
