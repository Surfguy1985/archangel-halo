# Halo Site Twin (Unity)

Building-first 3D twin fed by Halo API. Works with **Unity MCP** (CoplayDev or Unity AI) for agent control.

## Setup

1. Unity 2021.3+ or Unity 6 — open `unity/HaloSiteTwin` (or copy `Assets/Scripts` into your project).
2. Optional: install [CoplayDev Unity MCP](https://github.com/CoplayDev/unity-mcp) for AI scene control.
3. Create a scene: empty GameObject + `HaloApiClient` + `SiteTwinRenderer` + `HaloTwinMcpBridge`.
4. Create **Halo → Site Twin Config** asset: set `apiBase` + `propertyId`.
5. Play — buildings + on-site crews update every few seconds.

## API

- `GET /api/properties/:id/unity-twin` — Unity-optimized snapshot
- `GET /api/properties/:id/building-ops` — full ops plate

## MCP agent prompts (with Unity MCP connected)

- "Focus camera on Building 12"
- "List on-site crews from HaloTwinMcpBridge"
- "Read console for Halo Twin headline"
