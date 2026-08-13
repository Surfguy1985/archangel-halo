---
name: HALO Falkon mode badge
description: The HaloCommand badge must read gatewayMode (the DB connection mode), not overallHealth (peer network health).
---

## Bug fixed

`deriveFalkonMode()` in both HaloCommand files used `health.overallHealth` (peer health)
to derive the display mode. A healthy peer network does NOT mean a verified S2S connection.
With no connection row in `falkon_connections`, `overallHealth === "healthy"` (UR Founders peer)
was showing "ASSISTED" when the real mode was "OFF".

## Correct implementation

```typescript
function deriveFalkonMode(health?: { gatewayMode?: string; overallHealth?: string }): FalkonMode {
  const mode = health?.gatewayMode;
  if (!mode || mode === "OFF" || mode === "SHADOW") return "SHADOW";
  if (mode === "ASSISTED") return "ASSISTED";
  if (mode === "LIVE") return "LIVE";
  return "SHADOW";
}
```

`gatewayMode` comes from `GET /api/falkon/network/health` → `conn?.mode ?? "OFF"` (correct).

**Files:** `artifacts/halo/src/pages/HaloCommand.tsx`, `artifacts/halo-desktop/src/pages/HaloCommand.tsx`

**Why:** The badge is the operator's trust signal. Showing the wrong mode masks an unverified gateway.
