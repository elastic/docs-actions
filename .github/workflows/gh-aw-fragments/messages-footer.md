---
safe-outputs:
  messages:
    footer: "${{ inputs.messages-footer || '---\n[Docs automation](https://github.com/elastic/docs-actions) | [From workflow: {workflow_name}]({run_url})\n\nReact with 👍 if helpful, 👎 if not.' }}"
---

## Message Footer

A footer is automatically appended to all comments and reviews. Do not add your own footer or sign-off — the runtime handles this.
