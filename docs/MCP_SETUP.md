# MCP Server Setup

The feed exposes a [Model Context Protocol](https://modelcontextprotocol.io/) endpoint at `/mcp` that lets LLM agents manage all admin operations through tool calling.

## Authentication

The MCP endpoint uses the same session tokens as the governance system. Obtain a token by logging in through the governance UI or CLI, then pass it as a Bearer token:

```
Authorization: Bearer <session-token>
```

Only admin DIDs (listed in `BOT_ADMIN_DIDS`) are allowed access. Non-admin sessions receive a 403.

## Transport

The server uses **Streamable HTTP** transport in stateless mode. Each request creates a fresh MCP server instance — no session tracking is required.

- `POST /mcp` — JSON-RPC requests (initialize, tools/list, tools/call)
- `GET /mcp` — Server-Sent Events stream
- `DELETE /mcp` — Returns 405 (stateless mode, no sessions to terminate)

Content negotiation requires:
```
Content-Type: application/json
Accept: application/json, text/event-stream
```

## Tools (23 total)

### Governance (10)

| Tool | Description |
|------|-------------|
| `get_status` | Overall system status (epoch, scoring, subscribers) |
| `list_epochs` | List all governance epochs |
| `get_governance_status` | Current governance state and active weights |
| `start_voting` | Open a voting period |
| `close_voting` | Close the active voting period |
| `trigger_epoch_transition` | Transition to next epoch with aggregated weights |
| `get_content_rules` | Current include/exclude keyword rules |
| `update_content_rules` | Modify content filtering keywords |
| `get_vote_summary` | Vote breakdown for a specific epoch |
| `preview_aggregation` | Preview trimmed-mean aggregation results |

### Feed & Scoring (5)

| Tool | Description |
|------|-------------|
| `get_feed_health` | Database, scoring pipeline, Jetstream, and subscriber health |
| `trigger_rescore` | Trigger immediate scoring pipeline run |
| `reconnect_jetstream` | Force Jetstream WebSocket reconnection |
| `explain_post_score` | Detailed score breakdown for a specific post |
| `counterfactual_analysis` | What-if analysis with hypothetical weights |

### Participants (3)

| Tool | Description |
|------|-------------|
| `list_participants` | List approved participants (private feed mode) |
| `add_participant` | Add participant by DID or Bluesky handle |
| `remove_participant` | Remove approved participant |

### Export (3)

| Tool | Description |
|------|-------------|
| `export_votes` | Anonymized vote data for an epoch (JSON) |
| `export_scores` | Score decomposition with pagination (JSON) |
| `export_audit` | Audit log entries with optional date range (JSON) |

### Announcements (2)

| Tool | Description |
|------|-------------|
| `list_announcements` | List all announcements |
| `send_announcement` | Post an announcement (max 280 chars) |

## Claude Desktop Configuration

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "corgi-feed": {
      "url": "https://feed.corgi.network/mcp",
      "headers": {
        "Authorization": "Bearer <session-token>"
      }
    }
  }
}
```

## Example Usage (curl)

List available tools:

```bash
curl -X POST https://feed.corgi.network/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Call a tool:

```bash
curl -X POST https://feed.corgi.network/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'
```

## Architecture

Every MCP tool delegates to existing admin API endpoints via Fastify's `app.inject()`. This means:

- Zero business logic duplication — tools are thin HTTP adapters
- Full middleware stack runs (requireAdmin, Zod validation, audit logging)
- Any route changes are automatically reflected in MCP tools
- Rate limiting applies (admin rate limit of 30 req/min)
