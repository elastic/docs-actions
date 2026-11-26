#!/usr/bin/env bash

set -euo pipefail

failed=false

while IFS= read -r -d '' entry; do
  metadata="${entry%%$'\t'*}"
  path="${entry#*$'\t'}"
  read -r mode object_id stage <<<"${metadata}"

  [[ "${mode}" == "120000" ]] || continue

  if [[ "$(git cat-file -s "${object_id}")" -eq 0 ]]; then
    echo "Symlink target is empty: ${path}" >&2
    failed=true
    continue
  fi

  if git cat-file blob "${object_id}" \
    | LC_ALL=C od -An -t u1 \
    | LC_ALL=C grep -Eq '(^|[[:space:]])(0|10|13)($|[[:space:]])'; then
    echo "Symlink target contains a NUL, CR, or LF byte: ${path}" >&2
    failed=true
  fi
done < <(git ls-files --stage -z)

if [[ "${failed}" == true ]]; then
  echo "Symlink targets must be non-empty and must not contain line breaks or NUL bytes." >&2
  exit 1
fi
