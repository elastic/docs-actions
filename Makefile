.PHONY: help setup compile lint

GH_AW_VERSION ?= v0.86.2

help:
	@echo "docs-actions — Elastic documentation GitHub Actions and agentic workflows"
	@echo ""
	@echo "Agentic workflow targets:"
	@echo "  setup              - Install gh-aw extension ($(GH_AW_VERSION))"
	@echo "  compile            - Compile workflow .md sources to .lock.yml files"
	@echo "  lint               - Run all pre-commit hooks"
	@echo ""
	@echo "Workflow sources live in .github/workflows/gh-aw-*.md. Edit those, then run 'make compile'."

setup:
	@if gh extension list | rg -q '^gh aw\s+github/gh-aw\s+$(GH_AW_VERSION)$$'; then \
		echo "gh-aw $(GH_AW_VERSION) already installed"; \
	else \
		echo "Installing gh-aw extension $(GH_AW_VERSION)..."; \
		gh extension remove aw >/dev/null 2>&1 || true; \
		gh extension install github/gh-aw --pin $(GH_AW_VERSION); \
	fi

compile: setup
	@gh aw compile

lint:
	@pre-commit run --all-files
