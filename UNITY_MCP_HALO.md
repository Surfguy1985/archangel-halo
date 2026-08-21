# Unity MCP × Halo Site Twin

## Quick start (Mac)

1. Unity Hub → New 3D project (2021.3+ or Unity 6).
2. Copy `unity/HaloSiteTwin/Assets/Scripts` into the project `Assets/`.
3. Package Manager → **Add from git URL**:
   ```
   https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity
   ```
4. Menu **Halo → Setup Site Twin Scene** (creates config + wires components).
5. Press **Play** — buildings + live crews from production API.
6. **Window → MCP for Unity → Configure** Claude/Cursor. Leave Unity open.

### Defaults (already in config)

| Field | Value |
|-------|--------|
| apiBase | `https://archangel-halo.replit.app` |
| propertyId | `49dec4b1-1dc5-4b59-8025-0c0bc14d35ce` (Thornbury) |

### Claude Desktop — also add Halo ops MCP

Copy from `unity/HaloSiteTwin/mcp.claude.example.json` into  
`~/Library/Application Support/Claude/claude_desktop_config.json`  
Replace `ABS_PATH_TO_REPO`.

Unity MCP tools (scene) + `halo_*` tools (ops data) in one agent.

### Agent prompts

- “Call halo_list_on_site”
- “Call halo_focus_hint then FocusDensest on HaloTwinMcpBridge”
- “Read Unity console for Halo Twin headline”

### Without Unity

Browser: `/site-twin/49dec4b1-1dc5-4b59-8025-0c0bc14d35ce`

### Features

- Poll building-ops every 3s
- Building cubes + number labels
- Amber crew spheres (on-site only)
- Heat cylinders
- Densest building pulse + FocusDensest()
- MCP bridge: headline, list crew, focus, refresh
