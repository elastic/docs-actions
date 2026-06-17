---
description: Install APM packages for gh-aw workflows.
import-schema:
  packages:
    type: array
    items:
      type: string
    required: true
    description: APM package references to install before the agent runs.
  target:
    type: string
    required: false
    default: copilot
    description: Agent target to compile APM bundles for.
jobs:
  apm:
    runs-on: ubuntu-slim
    needs: [activation]
    permissions: {}
    steps:
      - name: Render package list
        id: list
        env:
          AW_APM_PACKAGES: ${{ github.aw.import-inputs.packages }}
        run: |
          set -euo pipefail
          raw="${AW_APM_PACKAGES:-[]}"

          if printf '%s' "$raw" | jq -e 'type == "array"' >/dev/null 2>&1; then
            packages_json="$raw"
          else
            packages_json="$(python3 -c 'import json, re, sys; s=sys.argv[1].strip(); s=s[1:-1] if s.startswith("[") and s.endswith("]") else s; print(json.dumps([t for t in re.split(r"[\s,]+", s) if t]))' "$raw")"
          fi

          count="$(printf '%s' "$packages_json" | jq 'length')"
          if [ "$count" -eq 0 ]; then
            echo "::error::shared/apm.md import provided no packages."
            exit 1
          fi

          deps="$(printf '%s' "$packages_json" | jq -r '.[] | "- " + .')"
          delim="APMDEPS_$(openssl rand -hex 8)"
          {
            printf 'deps<<%s\n' "$delim"
            printf '%s\n' "$deps"
            printf '%s\n' "$delim"
          } >> "$GITHUB_OUTPUT"

          printf '::notice::APM packages: %s\n' "$(printf '%s' "$packages_json" | jq -r 'join(", ")')"
      - name: Pack APM packages
        id: pack
        uses: microsoft/apm-action@v1.7.2
        env:
          GITHUB_TOKEN: ${{ secrets.GH_AW_PLUGINS_TOKEN || secrets.GH_AW_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}
        with:
          dependencies: ${{ steps.list.outputs.deps }}
          isolated: 'true'
          pack: 'true'
          archive: 'true'
          target: ${{ github.aw.import-inputs.target }}
          working-directory: /tmp/gh-aw/apm-workspace
      - name: Upload APM bundle artifact
        if: success()
        uses: actions/upload-artifact@v7
        with:
          name: ${{ needs.activation.outputs.artifact_prefix }}apm
          path: ${{ steps.pack.outputs.bundle-path }}
          retention-days: '1'
steps:
  - name: Download APM bundle artifact
    uses: actions/download-artifact@v8.0.1
    with:
      name: ${{ needs.activation.outputs.artifact_prefix }}apm
      path: /tmp/gh-aw/apm-bundles
  - name: Build bundle list
    run: |
      set -euo pipefail
      mapfile -t list < <(find /tmp/gh-aw/apm-bundles -name '*.tar.gz' | sort)
      [ ${#list[@]} -gt 0 ] || { echo '::error::no apm bundles found'; exit 1; }
      printf '%s\n' "${list[@]}" > /tmp/gh-aw/apm-bundle-list.txt
  - name: Restore APM packages
    uses: microsoft/apm-action@v1.7.2
    with:
      bundles-file: /tmp/gh-aw/apm-bundle-list.txt
source: microsoft/apm/.github/workflows/shared/apm.md
---
