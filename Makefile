.PHONY: help setup compile lint

help:
	@echo "docs-actions — Elastic documentation GitHub Actions and agentic workflows"
	@echo ""
	@echo "Agentic workflow targets:"
	@echo "  setup              - Install gh-aw extension"
	@echo "  compile            - Compile workflow .md sources to .lock.yml files"
	@echo "  lint               - Run all pre-commit hooks"
	@echo ""
	@echo "Workflow sources live in workflows/. Edit .md files there, then run 'make compile'."

setup:
	@if gh aw --help >/dev/null 2>&1; then \
		echo "gh-aw already installed"; \
	else \
		echo "Installing gh-aw extension..."; \
		gh extension install github/gh-aw; \
	fi

compile: setup
	@./scripts/compile.sh

lint:
	@pre-commit run --all-files
