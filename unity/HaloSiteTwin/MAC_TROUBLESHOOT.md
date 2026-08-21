# Mac — Halo Site Twin not working

## 1. Confirm API from Terminal (same Mac)

```bash
curl -s "https://archangel-halo.replit.app/api/building-ops/health"
curl -s "https://archangel-halo.replit.app/api/properties/49dec4b1-1dc5-4b59-8025-0c0bc14d35ce/building-ops" | head -c 400
```

Both must return JSON with `"ok":true`. If not, network/VPN/firewall — not Unity.

## 2. Unity setup (fresh)

1. Delete old Halo objects if broken.
2. Copy latest `Assets/Scripts` from repo (`ced8bab` or newer).
3. **Halo → Setup Site Twin Scene**
4. Select `HaloSiteTwin` in Hierarchy — Inspector must show **Config** assigned.
5. Press **Play**.

**Top-left HUD:**
- `LIVE · …` = working
- `ERROR: …` = read the message (TLS, 404, empty propertyId)

**Console** should show `[Halo] Health OK` then `[Halo Twin] …`

## 3. Common fixes

| Symptom | Fix |
|---------|-----|
| No Halo menu | Scripts not under `Assets/`; wait for compile; check Console for C# errors |
| Config missing | Halo → Setup again |
| Health failed | API down or Mac offline; test curl above |
| LIVE but empty scene | Camera far away — select Building 1, Frame (F); or HaloTwinMcpBridge → Focus Densest |
| Json / parse errors | Pull latest client (null lat/lng sanitizer) |
| MCP tools missing | Window → MCP for Unity; Unity must stay open; restart Claude after configure |

## 4. Unity MCP (CoplayDev)

```
https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity
```

Package Manager → + → git URL. Then Window → MCP for Unity → Configure All.

## 5. Send us

- Screenshot of **Play mode HUD**
- Console lines starting with `[Halo]`
- Output of the two `curl` commands
