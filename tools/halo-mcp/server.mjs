#!/usr/bin/env node
/**
 * Halo MCP — heavy tool surface for Claude / Cursor / Grok agents.
 * Pair with CoplayDev Unity MCP when the 3D scene is open.
 *
 * HALO_API_BASE, HALO_PROPERTY_ID
 */
import { createInterface } from "readline";

const BASE = (process.env.HALO_API_BASE || "http://127.0.0.1:5000").replace(/\/$/, "");
const PROPERTY_ID = process.env.HALO_PROPERTY_ID || "";

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 800), status: res.status };
  }
}

function pid(args) {
  return args?.propertyId || PROPERTY_ID;
}

const TOOLS = [
  {
    name: "halo_health",
    description: "Health: building-ops, unity-twin, work-reviews",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "halo_building_ops",
    description: "Full live plate: buildings, presence, heat, units, headline",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_unity_twin",
    description: "Unity-optimized twin snapshot (same live data + 3D hints)",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_list_on_site",
    description: "Crews on site with unit-from-job titles",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_focus_hint",
    description: "Which building Unity/web twin should focus (densest or explicit)",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        building: { type: "number" },
      },
    },
  },
  {
    name: "halo_heat",
    description: "GPS heat cells for the property",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_units_status",
    description: "Unit list with job status (turn board without geometry)",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_building_qr",
    description: "QR payloads for breezeway check-in signs",
    inputSchema: { type: "object", properties: { propertyId: { type: "string" } } },
  },
  {
    name: "halo_checkin",
    description: "QR/NFC building check-in for a crew",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        crewId: { type: "string" },
        building: { type: "number" },
        lat: { type: "number" },
        lng: { type: "number" },
      },
      required: ["crewId", "building"],
    },
  },
  {
    name: "halo_money_lock_summary",
    description: "Dispatch money-lock summary (exceptions vs approved)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "halo_operator_status",
    description: "Halo Operator last status / health",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "halo_work_reviews_health",
    description: "Work reviews pipeline health",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "halo_unity_command",
    description: "Structured command for Unity MCP bridge (focus/list/headline)",
    inputSchema: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        action: {
          type: "string",
          enum: ["focus_building", "list_on_site", "headline", "show_heat"],
        },
        building: { type: "number" },
      },
      required: ["action"],
    },
  },
];

async function callTool(name, args = {}) {
  const id = pid(args);
  switch (name) {
    case "halo_health":
      return {
        base: BASE,
        buildingOps: await api("/api/building-ops/health"),
        unityTwin: await api("/api/unity-twin/health"),
        workReviews: await api("/api/work-reviews/health"),
      };
    case "halo_building_ops":
      if (!id) return { error: "propertyId required" };
      return api(`/api/properties/${id}/building-ops`);
    case "halo_unity_twin":
      if (!id) return { error: "propertyId required" };
      return api(`/api/properties/${id}/unity-twin`);
    case "halo_list_on_site": {
      if (!id) return { error: "propertyId required" };
      const data = await api(`/api/properties/${id}/building-ops`);
      const onSite = (data.presence || []).filter((p) => p.onSite);
      return {
        headline: data.summary?.headline,
        count: onSite.length,
        byBuilding: data.byBuilding,
        crews: onSite.map((p) => ({
          name: p.crewName,
          building: p.building,
          unitNo: p.unitNo,
          title: p.title,
          confidence: p.confidence,
        })),
      };
    }
    case "halo_focus_hint": {
      if (!id) return { error: "propertyId required" };
      const data = await api(`/api/properties/${id}/building-ops`);
      if (args.building) {
        return {
          action: "focus_building",
          building: args.building,
          unity: `HaloTwinMcpBridge.FocusBuilding(${args.building})`,
          pin: (data.buildings || []).find((x) => x.building === args.building) || null,
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
    case "halo_heat": {
      if (!id) return { error: "propertyId required" };
      const data = await api(`/api/properties/${id}/building-ops`);
      return { heat: data.heat || [], count: (data.heat || []).length };
    }
    case "halo_units_status": {
      if (!id) return { error: "propertyId required" };
      const data = await api(`/api/properties/${id}/building-ops`);
      return { units: data.units || [], count: (data.units || []).length };
    }
    case "halo_building_qr":
      if (!id) return { error: "propertyId required" };
      return api(`/api/properties/${id}/building-ops/qr`);
    case "halo_checkin": {
      if (!id) return { error: "propertyId required" };
      return api(`/api/properties/${id}/building-ops/checkin`, {
        method: "POST",
        body: JSON.stringify({
          crewId: args.crewId,
          building: args.building,
          lat: args.lat,
          lng: args.lng,
        }),
      });
    }
    case "halo_money_lock_summary":
      return api("/api/work-reviews/money-lock/summary");
    case "halo_operator_status":
      return api("/api/halo-operator/health").catch(() =>
        api("/api/halo-operator/status")
      );
    case "halo_work_reviews_health":
      return api("/api/work-reviews/health");
    case "halo_unity_command": {
      if (!id && args.action !== "headline") {
        /* allow headline via env */
      }
      if (args.action === "headline") {
        const data = id ? await api(`/api/properties/${id}/building-ops`) : null;
        return {
          action: "headline",
          text: data?.summary?.headline || "set HALO_PROPERTY_ID",
          unity: "HaloTwinMcpBridge.GetHeadline()",
        };
      }
      if (!id) return { error: "propertyId required" };
      if (args.action === "list_on_site") {
        return callTool("halo_list_on_site", args);
      }
      if (args.action === "show_heat") {
        return callTool("halo_heat", args);
      }
      if (args.action === "focus_building") {
        return callTool("halo_focus_hint", { ...args, building: args.building });
      }
      return { error: "unknown action" };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

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
          serverInfo: { name: "halo-mcp", version: "2.0.0" },
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
      const result = await callTool(params?.name, params?.arguments || {});
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: String(e.message || e) },
    });
  }
});
