.PHONY: help setup setup-gh-aw compile lint-workflows lint release

help:
	@echo "docs-actions — Elastic documentation GitHub Actions and agentic workflows"
	@echo ""
	@echo "Agentic workflow targets:"
	@echo "  setup              - Install gh-aw extension"
	@echo "  compile            - Compile workflow .md sources to .lock.yml files"
	@echo "  lint-workflows     - Validate example.yml trigger files with actionlint"
	@echo "  lint               - Run all linters"
	@echo ""
	@echo "Workflow sources live in workflows/. Edit .md files there, then run 'make compile'."

setup: setup-gh-aw

setup-gh-aw:
	@if gh aw --help >/dev/null 2>&1; then \
		echo "gh-aw already installed"; \
	else \
		echo "Installing gh-aw extension..."; \
		gh extension install github/gh-aw; \
	fi

compile: setup-gh-aw
	@./scripts/compile.sh

lint-workflows:
	@echo "Validating workflow trigger files..."
	@find workflows -name "example.yml" 2>/dev/null | while read -r file; do \
		echo "Checking $$file..."; \
		actionlint "$$file" || exit 1; \
	done

lint: lint-workflows

# Release a new version
# Usage: make release VERSION=1.7.0
release:
ifndef VERSION
	@echo "Error: VERSION is required"
	@echo "Usage: make release VERSION=1.7.0"
	@echo ""
	@echo "Recent tags:"
	@git tag --sort=-version:refname | head -10
	@exit 1
endif
	@echo "Creating release v$(VERSION)..."
	@if ! echo "$(VERSION)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$$'; then \
		echo "Error: VERSION must be in semver format (e.g., 1.7.0)"; \
		exit 1; \
	fi
	@if git rev-parse "v$(VERSION)" >/dev/null 2>&1; then \
		echo "Error: Tag v$(VERSION) already exists"; \
		exit 1; \
	fi
	@echo ""
	@echo "This will:"
	@echo "  1. Create tag v$(VERSION)"
	@echo "  2. Push to origin (triggers release workflow + major tag update)"
	@echo ""
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@git tag "v$(VERSION)"
	@git push origin "v$(VERSION)"
	@echo ""
	@echo "Tag v$(VERSION) pushed."
