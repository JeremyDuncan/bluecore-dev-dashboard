# syntax=docker/dockerfile:1

# ---- deps: install node_modules once, cached on package-lock.json ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY mcp/package.json mcp/package-lock.json mcp/
RUN npm ci --prefix mcp

# ---- dev: live-reloading preview server + sync scripts ----
FROM deps AS dev
# pandoc converts .docx (Drive downloads, Box) to Markdown; git clones GitHub wikis; pdftotext reads Box PDFs
RUN apt-get update && apt-get install -y --no-install-recommends pandoc unzip git ca-certificates poppler-utils && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 3000
# --poll makes file watching work on bind mounts (macOS/Windows)
CMD ["npm", "start", "--", "--host", "0.0.0.0", "--poll", "1000"]

# ---- build: static site, served from the root path ----
FROM deps AS build
ARG SITE_URL=http://localhost:8080
ARG BASE_URL=/
# The chat and live Status data go through nginx on the same address (see docker/nginx.conf),
# so they also work when the site is shared through a tunnel such as ngrok
ARG CHAT_API_URL=/api/chat
ARG LIVE_API_URL=/api/live
# true: the Notebooks page and links (JUPYTER_NOTEBOOK in .env; off by default)
ARG JUPYTER_NOTEBOOK=false
ENV SITE_URL=$SITE_URL BASE_URL=$BASE_URL CHAT_API_URL=$CHAT_API_URL LIVE_API_URL=$LIVE_API_URL JUPYTER_NOTEBOOK=$JUPYTER_NOTEBOOK
COPY . .
RUN npm run build

# ---- prod: tiny nginx image with only the static files ----
FROM nginx:1.27-alpine AS prod
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80

# ---- mcp: MCP server for AI agents, with the same docs snapshot as the prod site ----
FROM node:22-alpine AS mcp
WORKDIR /app
COPY mcp/package.json mcp/package-lock.json mcp/
RUN npm ci --prefix mcp --omit=dev
COPY mcp/*.mjs mcp/
COPY mcp/starter-notebooks mcp/starter-notebooks
COPY docs docs
# Which project boards / orgs the live API may serve
COPY docs-sources.json ./
# The server runs as "node", so make sure every imported folder is readable whatever its permissions on disk
RUN chmod -R a+rX docs
ARG SITE_URL=http://localhost:8080
ENV DOCS_SITE_URL=$SITE_URL NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "mcp/server.mjs", "--http"]
