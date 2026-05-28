#!/usr/bin/env bash
# F033.5 — shared helpers for the four cc-projects hooks.
#
# Each hook script sources this file. Centralises:
#   - PROJECTS_MCP_URL (where to talk to the projects-server)
#   - PROJECTS_MCP_KEY (optional Bearer for cloud mode)
#   - call_mcp(toolname, jsonargs) — wraps a JSON-RPC tools/call + parses the
#     SSE response back to a single JSON blob
#
# Hooks fail gracefully: if the server is unreachable they exit 0 without
# output so cc keeps working. Their value is real-time orientation, not
# correctness-critical.

set -u
# Don't 'set -e' — we want the hooks to no-op on network failures, not abort cc.

PROJECTS_MCP_URL="${PROJECTS_MCP_URL:-http://localhost:7474/mcp}"
PROJECTS_MCP_KEY="${PROJECTS_MCP_KEY:-}"
PROJECTS_HOOK_DEBUG="${PROJECTS_HOOK_DEBUG:-0}"
PROJECTS_HOOK_LOG="${PROJECTS_HOOK_LOG:-$HOME/.claude/logs/projects-hooks.log}"

mkdir -p "$(dirname "$PROJECTS_HOOK_LOG")" 2>/dev/null || true

hook_log() {
  if [[ "$PROJECTS_HOOK_DEBUG" == "1" ]]; then
    printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >> "$PROJECTS_HOOK_LOG"
  fi
}

# call_mcp <tool_name> <args_json>
# Returns: tool output as JSON on stdout, or empty string on error.
call_mcp() {
  local tool_name="$1"
  local args_json="$2"

  local auth_header=()
  if [[ -n "$PROJECTS_MCP_KEY" ]]; then
    auth_header=(-H "Authorization: Bearer $PROJECTS_MCP_KEY")
  fi

  local body
  body=$(
    jq -nc \
      --arg name "$tool_name" \
      --argjson args "$args_json" \
      '{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: $name, arguments: $args } }'
  )

  local response
  response=$(
    curl -s --max-time 4 \
      -X POST "$PROJECTS_MCP_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      "${auth_header[@]}" \
      --data "$body" 2>/dev/null
  )

  if [[ -z "$response" ]]; then
    hook_log "call_mcp $tool_name: empty response (server unreachable?)"
    return 1
  fi

  # MCP HTTP transport replies as SSE: lines start with "event:" / "data:".
  # We want the data line's JSON. Strip the SSE framing.
  local data_line
  data_line=$(printf '%s' "$response" | awk -F': ' '/^data: /{print substr($0,7); exit}')
  if [[ -z "$data_line" ]]; then
    # Plain JSON response (no SSE framing) — happens with some transports.
    data_line="$response"
  fi

  # Pull result.content[0].text and parse as JSON.
  printf '%s' "$data_line" | jq -r '.result.content[0].text // empty' 2>/dev/null
}

# resolve_repo — best-effort "owner/name" for the current cwd. Empty string
# if not a github clone. Uses bash parameter expansion only — macOS sed
# does not support PCRE non-greedy quantifiers.
resolve_repo() {
  local origin
  origin=$(git remote get-url origin 2>/dev/null) || { printf ''; return 0; }
  origin=${origin#git@github.com:}
  origin=${origin#https://github.com/}
  origin=${origin#http://github.com/}
  origin=${origin%.git}
  origin=${origin%/}
  printf '%s' "$origin"
}
