# Tool versions
ACTIONLINT_VERSION := 1.7.11
GH_AW_VERSION := v0.45.1

# Helper: Detect OS and architecture
DETECT_OS_ARCH = OS=$$(uname -s | tr '[:upper:]' '[:lower:]'); \
	ARCH=$$(uname -m); \
	case "$$ARCH" in \
		x86_64) ARCH="amd64" ;; \
		arm64|aarch64) ARCH="arm64" ;; \
	esac

# Helper: Download a file using curl or wget
define download-file
	if command -v curl >/dev/null 2>&1; then \
		if [ -n "$(2)" ]; then \
			curl -sSL "$(1)" -o "$(2)"; \
		else \
			curl -sSL "$(1)"; \
		fi; \
	elif command -v wget >/dev/null 2>&1; then \
		if [ -n "$(2)" ]; then \
			wget -qO "$(2)" "$(1)"; \
		else \
			wget -qO- "$(1)"; \
		fi; \
	else \
		echo "Error: curl or wget required"; \
		exit 1; \
	fi
endef

.PHONY: help setup setup-actionlint setup-gh-aw compile lint-workflows lint release

help:
	@echo "docs-actions — Elastic documentation GitHub Actions and agentic workflows"
	@echo ""
	@echo "Agentic workflow targets:"
	@echo "  setup              - Install gh-aw compiler and actionlint to bin/"
	@echo "  compile            - Compile workflow .md sources to .lock.yml files"
	@echo "  lint-workflows     - Validate example.yml trigger files with actionlint"
	@echo "  lint               - Run all linters"
	@echo ""
	@echo "Workflow sources live in workflows/. Edit .md files there, then run 'make compile'."

setup: setup-actionlint setup-gh-aw
	@echo ""
	@echo "Setup complete!"

setup-gh-aw:
	@echo "Setting up gh-aw compiler..."
	@if command -v go >/dev/null 2>&1; then \
		echo "Installing gh-aw $(GH_AW_VERSION)..."; \
		GOBIN="$$(pwd)/bin" go install github.com/github/gh-aw/cmd/gh-aw@$(GH_AW_VERSION) && \
		echo "gh-aw installed to bin/gh-aw"; \
	else \
		echo "Go not found. Install Go first: https://go.dev/dl/"; \
		exit 1; \
	fi

setup-actionlint:
	@echo "Setting up actionlint..."
	@mkdir -p bin
	@ACTIONLINT_VERSION="$(ACTIONLINT_VERSION)"; \
	ACTIONLINT_BIN="bin/actionlint"; \
	if [ -f "$$ACTIONLINT_BIN" ]; then \
		echo "actionlint already installed: $$($$ACTIONLINT_BIN --version 2>&1 | head -1)"; \
	else \
		echo "Downloading actionlint v$$ACTIONLINT_VERSION..."; \
		$(DETECT_OS_ARCH); \
		URL="https://github.com/rhysd/actionlint/releases/download/v$$ACTIONLINT_VERSION/actionlint_$${ACTIONLINT_VERSION}_$${OS}_$${ARCH}.tar.gz"; \
		$(call download-file,$$URL) | tar -xz -C bin actionlint && chmod +x "$$ACTIONLINT_BIN" && \
		echo "actionlint installed to $$ACTIONLINT_BIN"; \
	fi

compile: setup-gh-aw
	@./scripts/compile.sh bin/gh-aw

lint-workflows: setup-actionlint
	@echo "Validating workflow trigger files..."
	@ACTIONLINT="bin/actionlint"; \
	find workflows -name "example.yml" 2>/dev/null | while read -r file; do \
		echo "Checking $$file..."; \
		$$ACTIONLINT "$$file" || exit 1; \
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
