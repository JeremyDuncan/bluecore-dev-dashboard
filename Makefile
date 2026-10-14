.PHONY: up down sync pull box prod mcp chat logs shell rebuild

up:        ## Pull all sources (skip with SYNC=0), then live preview at http://localhost:3000 + MCP server (:3001) + Ask the docs chat (:3002)
	@$(MAKE) --no-print-directory pull
	docker compose --profile prod stop mcp-prod
	./scripts/with-chat.sh docker compose up --build --renew-anon-volumes

down:      ## Stop everything
	docker compose --profile prod --profile tools down
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

prod:      ## Pull all sources (skip with SYNC=0), then production build at http://localhost:8080 + MCP server (:3001) + Ask the docs chat (:3002)
	@$(MAKE) --no-print-directory pull
	docker compose stop mcp
	./scripts/with-chat.sh docker compose --profile prod up --build web mcp-prod

mcp:       ## Only the MCP server for AI agents (http://localhost:3001/mcp)
	docker compose up --build --renew-anon-volumes mcp

chat:      ## Only the "Ask the docs" chat helper (make up / make prod start it too) → http://localhost:3002
	node chat/server.mjs

shell:     ## Shell inside the dev container
	docker compose run --rm docs bash

rebuild:   ## Rebuild images from scratch (e.g. after changing package.json)
	docker compose build --no-cache
