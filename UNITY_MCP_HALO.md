# Unity MCP × Halo — Phase 1

## What shipped

| Piece | Path | Role |
|-------|------|------|
| **Unity scripts** | `unity/HaloSiteTwin/Assets/Scripts/` | Poll Halo, render buildings + crews |
| **Unity twin API** | `GET /api/properties/:id/unity-twin` | Geometry + MCP hints |
| **Live plate** | `GET /api/properties/:id/building-ops` | Crews, heat, jobs (Unity primary feed) |
| **Halo MCP server** | `tools/halo-mcp/server.mjs` | Claude/Cursor tools for ops data |
| **CoplayDev Unity MCP** | external package | AI controls Unity Editor/scene |

## Architecture

```
Claude / Cursor
   ├─ halo-mcp (this repo)     → jobs, buildings, on-site list
   └─ Unity MCP (CoplayDev)    → camera, GameObjects, console
            │
            ▼
   Halo Site Twin scene (C#)
            │ HTTP poll
            ▼
   Halo API /building-ops
```

## Install Unity MCP (Editor AI control)

1. Unity Package Manager → Add from git URL:
   ```
   https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity
   ```
2. Window → MCP for Unity → Configure clients (Claude / Cursor).
3. Copy `unity/HaloSiteTwin/Assets/Scripts` into your Unity project.
4. Scene setup: `HaloApiClient` + `SiteTwinRenderer` + `HaloTwinMcpBridge` + HaloConfig asset.

## Install Halo MCP (ops data for the same agent)

Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "halo": {
      "command": "node",
      "args": ["ABS_PATH/archangel-halo/tools/halo-mcp/server.mjs"],
      "env": {
        "HALO_API_BASE": "https://archangel-halo.replit.app",
        "HALO_PROPERTY_ID": "YOUR_PROPERTY_UUID"
      }
    }
  }
}
```

## Agent prompt examples

- "Call halo_list_on_site and then focus the Unity camera on the densest building"
- "halo_focus_hint then run FocusBuilding in the twin"
- "What's the Halo twin headline?"

## Replit activate

```bash
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
# Run API
curl -s http://127.0.0.1:5000/api/unity-twin/health
```

## Phase 2 (later)

- WebSocket live push instead of poll  
- WebGL build embedded in Pulse  
- Custom Unity MCP tools registered against HaloTwinMcpBridge  
