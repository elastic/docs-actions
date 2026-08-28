# shellcheck shell=bash
# Shared input validators for composite actions.
# Source from an action step: source "${GITHUB_ACTION_PATH}/../../scripts/validate-inputs.sh"

# Reject absolute paths, traversal, and newlines. Empty values pass (optional inputs).
validate_path() {
  local value="$1" name="$2"
  [ -z "$value" ] && return
  if [[ "$value" == /* ]]; then
    echo "::error::${name} must be a relative path: ${value}"; exit 1
  fi
  if [[ "$value" == *..* ]]; then
    echo "::error::${name} must not contain '..': ${value}"; exit 1
  fi
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "::error::${name} must not contain newlines"; exit 1
  fi
}

# Enforce a caller-supplied pattern. Empty values pass (optional inputs).
validate_identifier() {
  local value="$1" name="$2" pattern="$3"
  [ -z "$value" ] && return
  if [[ ! "$value" =~ $pattern ]]; then
    echo "::error::${name} contains disallowed characters: ${value}"; exit 1
  fi
}

# Single safe path segment. Empty values FAIL (required inputs).
validate_segment() {
  local value="$1" name="$2"
  if [[ ! "$value" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "::error::${name} must match [a-zA-Z0-9._-]+: ${value}"; exit 1
  fi
}
