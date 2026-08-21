#!/usr/bin/env node
/**
 * Halo MCP server (stdio) — AI agents call Halo ops without Unity Editor.
 * Pair with CoplayDev Unity MCP when the 3D scene is open.
 *
 * Env:
 *   HALO_API_BASE=https://archangel-halo.replit.app
 *   HALO_PROPERTY_ID=<uuid>
 *
 * Claude Desktop mcp.json example:
 * {
 *   "mcpServers": {
 *     "halo": {
 *       "command": "node",
 *       "args": ["/path/to/archangel-halo/tools/halo-mcp/server.mjs"],
 *       "env": { "HALO_API_BASE": "https://archangel-halo.replit.app", "HALO_PROPERTY_ID": "..." }
 *     }
 *   }
 * }
 */

import { createInterface } from "readline";

const BASE = (process.env.HALO_API_BASE || "http://127.0.0.1:5000").replace(/\/$/, "");
const PROPERTY_ID = process.env.HALO_PROPERTY_ID || "";

async function api(path, opts) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 500), status: res.status };
  }
}

const TOOLS = [
  {
    name: "halo_health",
    description: "Check Halo building-ops and unity-twin health",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "halo_building_ops",
    description: "Live building-first plate: crews on site, heat, units, headline",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: { type: "string", description: "Property UUID (optional if HALO_PROPERTY_ID set)" },
      },
    },
  },
  {
    name: "halo_list_on_site",
    description: "List crews currently on site with unit from job",
    inputSchema: {
      type: "object",
      properties: { propertyId: { type: "string" } },
    },
  },
  {
    name: "halo_building_qr",
    description: "QR payloads for building check-in signs",
    inputSchema: {
      type: "object",
      properties: { propertyId: { type: "string" } },
    },
  },
  {
    name: "halo_focus_hint",
    description: "Return which building an agent/Unity should focus (densest or named)",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        building: { type: "number", description: "Optional building number 1-20" },
      },
    },
  },
];

async function callTool(name, args = {}) {
  const pid = args.propertyId || PROPERTY_ID;
  switch (name) {
    case "halo_health": {
      const [a, b] = await Promise.all([
        api("/api/building-ops/health"),
        api("/api/unity-twin/health"),
      ]);
      return { buildingOps: a, unityTwin: b, base: BASE };
    }
    case "halo_building_ops": {
      if (!pid) return { error: "propertyId required" };
      return api(`/api/properties/${pid}/building-ops`);
    }
    case "halo_list_on_site": {
      if (!pid) return { error: "propertyId required" };
      const data = await api(`/api/properties/${pid}/building-ops`);
      const onSite = (data.presence || []).filter((p) => p.onSite);
      return {
        headline: data.summary?.headline,
        count: onSite.length,
        crews: onSite.map((p) => ({
          name: p.crewName,
          building: p.building,
          unitNo: p.unitNo,
          title: p.title,
        })),
      };
    }
    case "halo_building_qr": {
      if (!pid) return { error: "propertyId required" };
      return api(`/api/properties/${pid}/building-ops/qr`);
    }
    case "halo_focus_hint": {
      if (!pid) return { error: "propertyId required" };
      const data = await api(`/api/properties/${pid}/building-ops`);
      if (args.building) {
        const b = (data.buildings || []).find((x) => x.building === args.building);
        return {
          action: "focus_building",
          building: args.building,
          unity: `HaloTwinMcpBridge.FocusBuilding(${args.building})`,
          pin: b || null,
        };
      }
      const densest = Object.entries(data.byBuilding || {}).sort((a, b) => b[1] - a[1])[0];
      const building = densest ? Number(densest[0]) : 1;
      return {
        action: "focus_building",
        building,
        reason: densest ? `densest (${densest[1]} crews)` : "default Building 1",
        unity: `HaloTwinMcpBridge.FocusBuilding(${building})`,
        headline: data.summary?.headline,
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

// Minimal MCP stdio JSON-RPC
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "halo-mcp", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(name, args);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e.message || e) } });
  }
});
