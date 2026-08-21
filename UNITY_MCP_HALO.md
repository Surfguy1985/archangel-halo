# Unity MCP × Halo — HEAVY Phase 2

## Stack

| Layer | What |
|-------|------|
| **Live plate** | `GET /api/properties/:id/building-ops` |
| **SSE stream** | `GET /api/properties/:id/building-ops/stream?ms=4000` |
| **Unity twin** | `GET /api/properties/:id/unity-twin` (full live + 3D hints) |
| **Browser twin** | `/site-twin/:propertyId` (canvas, no Unity install) |
| **Halo MCP** | `tools/halo-mcp/server.mjs` v2 — 13 tools |
| **Unity scripts** | `unity/HaloSiteTwin/Assets/Scripts` |
| **Unity MCP** | CoplayDev package in Editor |

## Architecture

```
Claude / Grok / Cursor
  ├─ halo-mcp (ops + focus commands)
  └─ Unity MCP (scene camera / objects)
           │
     ┌─────┴──────┐
     ▼            ▼
  Browser      Unity Play
  /site-twin   HaloApiClient
     │            │
     └─────┬──────┘
           ▼
    Halo building-ops (+ SSE)
```

## MCP tools (halo-mcp v2)

- halo_health, halo_building_ops, halo_unity_twin
- halo_list_on_site, halo_focus_hint, halo_heat, halo_units_status
- halo_building_qr, halo_checkin
- halo_money_lock_summary, halo_operator_status, halo_work_reviews_health
- halo_unity_command (focus_building | list_on_site | headline | show_heat)

## Replit

```bash
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
# Run API on 5000
curl -s http://127.0.0.1:5000/api/unity-twin/health
curl -s http://127.0.0.1:5000/api/building-ops/health
# Browser: open /site-twin/PROPERTY_UUID
```

## Unity

1. Package: `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity`
2. Copy `Assets/Scripts`
3. HaloApiClient + SiteTwinRenderer + HeatRenderer + HaloTwinMcpBridge
4. HaloConfig: apiBase + propertyId

## Claude config

```json
{
  "mcpServers": {
    "halo": {
      "command": "node",
      "args": ["ABS/tools/halo-mcp/server.mjs"],
      "env": {
        "HALO_API_BASE": "https://archangel-halo.replit.app",
        "HALO_PROPERTY_ID": "UUID"
      }
    }
  }
}
```
