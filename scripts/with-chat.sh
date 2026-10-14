#!/usr/bin/env bash
# Runs a command (e.g. `docker compose up`) with the "Ask the docs" chat helper running next to it.
#
# The helper (chat/server.mjs) runs on this machine, not in Docker, because it uses your AI CLI
# logins (Claude Code, Codex); the chat panel shows setup steps for any that are missing.
# It's started in the background and stopped when the command exits (including Ctrl+C).
# If it's already running (another `make up`), it's left alone.
set -u
cd "$(dirname "$0")/.."

PORT="${CHAT_PORT:-3002}"
PID_FILE=.chat.pid
LOG_FILE=.chat.log
started=""

if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "[chat] Ask the docs helper already running → http://localhost:$PORT"
elif ! command -v node >/dev/null 2>&1; then
  echo "[chat] Skipping Ask the docs: Node.js isn't installed on this machine (https://nodejs.org)"
else
  node chat/server.mjs >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  started=1
  echo "[chat] Ask the docs helper started → http://localhost:$PORT (log: $LOG_FILE)"
fi

stop_chat() {
  if [ -n "$started" ] && [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
    rm -f "$PID_FILE"
    echo "[chat] Ask the docs helper stopped"
  fi
}
trap stop_chat EXIT
trap 'exit 130' INT TERM

"$@"
