.PHONY: up down sync pull box prod mcp chat lab logs shell rebuild

# Jupyter notebooks are off unless JUPYTER_NOTEBOOK=true (in .env, or `make up JUPYTER_NOTEBOOK=true`).
# On: JupyterLab (compose profile "notebooks") is built and started, and the site, MCP server and chat
# include notebooks. Off: it's neither built nor started, and a running one is removed. Exported so
# compose and the chat helper see the same value.
JUPYTER_NOTEBOOK ?= $(shell sed -n 's/^[[:space:]]*JUPYTER_NOTEBOOK[[:space:]]*=//p' .env 2>/dev/null | tail -1 | tr -d "\"' ")
export JUPYTER_NOTEBOOK
NOTEBOOKS_ON := $(filter true True TRUE 1 yes Yes YES on On ON,$(JUPYTER_NOTEBOOK))
NOTEBOOKS_PROFILE := $(if $(NOTEBOOKS_ON),--profile notebooks)
# Off: remove a JupyterLab left running from when notebooks were on
NOTEBOOKS_CLEANUP := $(if $(NOTEBOOKS_ON),@true,@docker compose --profile notebooks rm -sf jupyter >/dev/null 2>&1 || true)

up:        ## Pull all sources (skip with SYNC=0), then live preview at http://localhost:3000 + MCP server (:3001) + Ask the docs chat (:3002) + JupyterLab (:8888, if JUPYTER_NOTEBOOK=true)
	@$(MAKE) --no-print-directory pull
	docker compose --profile prod stop mcp-prod
	$(NOTEBOOKS_CLEANUP)
	./scripts/with-chat.sh docker compose $(NOTEBOOKS_PROFILE) up --build --renew-anon-volumes

down:      ## Stop everything
	docker compose --profile prod --profile tools --profile notebooks down
	@if [ -f .chat.pid ]; then kill $$(cat .chat.pid) 2>/dev/null; rm -f .chat.pid; echo "[chat] Ask the docs helper stopped"; fi

sync:      ## Pull every source (GitHub docs, Drive downloads, Box, Project Status) into docs/
	docker compose run --rm --build sync

# Used by up/prod: a failed source (no network, expired token) shouldn't stop the site from starting.
# SYNC=0 skips it for a quick restart with what's already in docs/ (make up SYNC=0).
SYNC ?= 1
pull:
ifeq ($(SYNC),0)
	@echo "[sync] Skipped (SYNC=0); starting with what's in docs/"
else
	@docker compose run --rm --build sync || echo "[sync] Some sources failed (see above); starting with what's in docs/"
endif

box:       ## Re-import only the Box folders
	docker compose run --rm --build sync npm run sync:box

prod:      ## Pull all sources (skip with SYNC=0), then production build at http://localhost:8080 + MCP server (:3001) + Ask the docs chat (:3002) + JupyterLab (:8888, if JUPYTER_NOTEBOOK=true)
	@$(MAKE) --no-print-directory pull
	docker compose stop mcp
	$(NOTEBOOKS_CLEANUP)
	./scripts/with-chat.sh docker compose --profile prod $(NOTEBOOKS_PROFILE) up --build web mcp-prod $(if $(NOTEBOOKS_ON),jupyter)

mcp:       ## Only the MCP server for AI agents (http://localhost:3001/mcp)
	docker compose up --build --renew-anon-volumes mcp

chat:      ## Only the "Ask the docs" chat helper (make up / make prod start it too) → http://localhost:3002
	node --watch chat/server.mjs

lab:       ## Open JupyterLab (make up / make prod start it) — prints its address with the current token
ifeq ($(NOTEBOOKS_ON),)
	@echo "Notebooks are off. Set JUPYTER_NOTEBOOK=true in .env and run make up."
else
	@echo "http://localhost:8888/lab?token=$$(docker compose --profile notebooks exec -T jupyter cat /run/jupyter/token)"
endif

shell:     ## Shell inside the dev container
	docker compose run --rm docs bash

rebuild:   ## Rebuild images from scratch (e.g. after changing package.json)
	docker compose build --no-cache
