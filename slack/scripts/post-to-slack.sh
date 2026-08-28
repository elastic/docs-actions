#!/usr/bin/env bash
set -euo pipefail

# Post a message through the elastic-docs-slack-notifier Lambda.
#
# Required environment variables:
#   LAMBDA_ARN      Lambda function ARN
#   SLACK_CHANNEL   Slack channel ID or name
#   GITHUB_OUTPUT   GitHub Actions output file path
#
# Optional environment variables:
#   SLACK_TEXT          Plain text fallback body
#   SLACK_BLOCKS        Block Kit blocks JSON array string
#   SLACK_ATTACHMENTS   Attachments JSON array string
#   FAIL_ON_ERROR       When "true", exit 1 on delivery failure

if [ -z "${SLACK_TEXT:-}" ] && [ -z "${SLACK_BLOCKS:-}" ] && [ -z "${SLACK_ATTACHMENTS:-}" ]; then
  echo "::error::At least one of text, blocks, or attachments is required"
  exit 1
fi

if [ -n "${SLACK_BLOCKS:-}" ]; then
  if ! echo "$SLACK_BLOCKS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "::error::blocks must be a JSON array"
    exit 1
  fi
fi

if [ -n "${SLACK_ATTACHMENTS:-}" ]; then
  if ! echo "$SLACK_ATTACHMENTS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "::error::attachments must be a JSON array"
    exit 1
  fi
fi

payload="$(jq -n \
  --arg channel "${SLACK_CHANNEL}" \
  --arg text "${SLACK_TEXT:-}" \
  --arg blocks "${SLACK_BLOCKS:-}" \
  --arg attachments "${SLACK_ATTACHMENTS:-}" \
  '
    {channel: $channel}
    + (if $text != "" then {text: $text} else {} end)
    + (if $blocks != "" then {blocks: ($blocks | fromjson)} else {} end)
    + (if $attachments != "" then {attachments: ($attachments | fromjson)} else {} end)
  ')"

aws lambda invoke \
  --function-name "$LAMBDA_ARN" \
  --payload "$payload" \
  --cli-binary-format raw-in-base64-out \
  invoke-response.json > invoke-meta.json

if jq -e '.FunctionError' invoke-meta.json >/dev/null; then
  error_type="$(jq -r '.errorType // "Unknown"' invoke-response.json)"
  error_message="$(jq -r '.errorMessage // "Unknown error"' invoke-response.json)"
  echo "success=false" >> "$GITHUB_OUTPUT"
  echo "::warning::Slack notifier failed ($error_type): $error_message"
  if [ "${FAIL_ON_ERROR:-false}" = "true" ]; then
    exit 1
  fi
  exit 0
fi

echo "success=true" >> "$GITHUB_OUTPUT"
echo "channel=$(jq -r '.channel' invoke-response.json)" >> "$GITHUB_OUTPUT"
echo "ts=$(jq -r '.ts' invoke-response.json)" >> "$GITHUB_OUTPUT"
