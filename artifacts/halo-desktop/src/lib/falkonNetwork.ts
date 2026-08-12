/**
 * Falkon Network — client-side API hooks.
 *
 * All endpoints talk directly to the HALO API server via fetch + TanStack Query.
 * These routes are not in the generated API client, so they live here as
 * hand-written hooks that follow the same conventions as the rest of the app.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function falkonApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(text || String(res.status));
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const FALKON_HEALTH_KEY = ["falkon", "network", "health"] as const;
export const FALKON_IDENTITY_KEY = ["falkon", "network", "identity"] as const;
export const FALKON_PEERS_KEY = ["falkon", "network", "peers"] as const;
export const FALKON_REQUESTS_KEY = ["falkon", "network", "requests"] as const;
export const FALKON_PHASES_KEY = ["falkon", "network", "phases"] as const;

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useFalkonHealth() {
  return useQuery({
    queryKey: FALKON_HEALTH_KEY,
    queryFn: () => falkonApi<FalkonHealth>("/falkon/network/health"),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  });
}

export function useFalkonIdentity() {
  return useQuery({
    queryKey: FALKON_IDENTITY_KEY,
    queryFn: () => falkonApi<FalkonIdentity>("/falkon/network/identity"),
    staleTime: 60_000,
  });
}

export function useFalkonPeers() {
  return useQuery({
    queryKey: FALKON_PEERS_KEY,
    queryFn: () => falkonApi<{ peers: FalkonPeer[] }>("/falkon/network/peers"),
    refetchInterval: 60_000,
  });
}

export function useFalkonRequests(params?: {
  direction?: "inbound" | "outbound";
  state?: string;
}) {
  const qs = params
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v != null) as [
            string,
            string,
          ][],
        ),
      ).toString()
    : "";
  return useQuery({
    queryKey: [...FALKON_REQUESTS_KEY, params],
    queryFn: () =>
      falkonApi<{ requests: FalkonRequest[] }>(
        `/falkon/network/requests${qs}`,
      ),
    refetchInterval: 20_000,
  });
}

export function useFalkonRequest(id: string | null) {
  return useQuery({
    queryKey: ["falkon", "network", "request", id],
    queryFn: () => falkonApi<FalkonRequest>(`/falkon/network/requests/${id}`),
    enabled: !!id,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useFalkonPhases() {
  return useQuery({
    queryKey: FALKON_PHASES_KEY,
    queryFn: () =>
      falkonApi<{ phases: FalkonPhase[] }>("/falkon/network/phases"),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateOutboundRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      peerId: string;
      capabilityId: string;
      summary: string;
      sharedData?: unknown;
    }) =>
      falkonApi<{ ok: boolean; request: FalkonRequest }>(
        "/falkon/network/requests/outbound",
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FALKON_REQUESTS_KEY });
    },
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      falkonApi<{ ok: boolean }>(`/falkon/network/requests/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: FALKON_REQUESTS_KEY }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      falkonApi<{ ok: boolean }>(`/falkon/network/requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: FALKON_REQUESTS_KEY }),
  });
}

export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      falkonApi<{ ok: boolean }>(`/falkon/network/requests/${id}/cancel`, {
        method: "POST",
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: FALKON_REQUESTS_KEY }),
  });
}

export function useRetryRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      falkonApi<{ ok: boolean }>(`/falkon/network/requests/${id}/retry`, {
        method: "POST",
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: FALKON_REQUESTS_KEY }),
  });
}

export function useRefreshPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      falkonApi<{ ok: boolean; newState: string }>(
        `/falkon/network/peers/${id}/refresh`,
        { method: "POST" },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: FALKON_PEERS_KEY }),
  });
}

// ---------------------------------------------------------------------------
// JARVIS formation intent detection
// ---------------------------------------------------------------------------

const FORMATION_RE =
  /\b(new\s+llc|entity\s+formation|us\s+company\s+setup|us\s+company|incorporate|form\s+a\s+company|start\s+a\s+company|company\s+formation|business\s+formation|register.*company|llc\s+setup|corp\s+setup|form.*llc|formation|register.*business|set\s+up\s+(a\s+)?(company|business|entity))\b/i;

export function isFalkonFormationIntent(text: string): boolean {
  return FORMATION_RE.test(text);
}

// ---------------------------------------------------------------------------
// Shared data disclosure for Ask Falkon sheet
// ---------------------------------------------------------------------------

export const SHARED_DATA_FIELDS = [
  { label: "Business name", key: "businessName", note: "Registered company name" },
  { label: "Partner ID", key: "partnerId", note: "Your unique Falkon Network identifier" },
  { label: "Contact email", key: "contactEmail", note: "Primary office contact" },
  { label: "Trust document URL", key: "trustDocUrl", note: "Publicly verifiable identity" },
] as const;

// Phase 1 capabilities for capability picker
export const PHASE1_CAPS = [
  { id: "property-management-platform", name: "Property Management Platform" },
  { id: "property-operations-workflow", name: "Property Operations Workflow" },
  { id: "contractor-make-ready-ops", name: "Contractor Make-Ready Operations" },
  { id: "job-dispatch-discovery", name: "Job & Dispatch Discovery" },
] as const;

// UR Founders specific capabilities (inbound request goes TO UR Founders)
export const UR_FOUNDERS_CAPS = [
  { id: "entity-formation", name: "Entity Formation" },
  { id: "compliance", name: "Compliance & Regulatory" },
  { id: "llc-corp-setup", name: "LLC / Corp Setup" },
  { id: "registered-agent", name: "Registered Agent" },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FalkonHealth {
  identityActive: boolean;
  gatewayConnected: boolean;
  gatewayMode: string;
  currentPhase: number;
  overallHealth: "healthy" | "partial" | "degraded" | "no_peers" | string;
  peers: FalkonPeerSummary[];
  pendingInboundRequests: number;
  lastAuditAt: string | null;
}

export interface FalkonPeerSummary {
  id: string;
  name: string;
  domain: string;
  healthState: string;
  lastCheckedAt: string | null;
}

export interface FalkonPeer {
  id: string;
  name: string;
  domain: string;
  trust_doc_url: string;
  capabilities_url: string;
  health_state: string;
  last_health_check_at: string | null;
  capabilities_data: {
    capabilities?: Array<{ id: string; name: string; description: string }>;
  } | null;
  trust_doc_data: unknown;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FalkonRequest {
  id: string;
  direction: "inbound" | "outbound";
  peer_id: string | null;
  peer_name: string | null;
  capability_id: string;
  capability_name: string | null;
  correlation_id: string;
  external_ref: string | null;
  approval_state: string;
  summary: string | null;
  shared_data_snapshot: unknown;
  requester_identity: unknown;
  provider_identity: unknown;
  request_events: Array<{
    ts: number;
    event: string;
    detail: string;
    attempt?: number;
  }>;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface FalkonPhase {
  phase: number;
  name: string;
  description: string;
  capabilities: Array<{ id: string; name: string; description: string }>;
  prerequisites: string[];
  whatThisUnlocks: string;
  enabled: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  readinessChecks: Array<{
    id: string;
    label: string;
    pass: boolean;
    detail: string;
  }>;
  ready: boolean;
}

export interface FalkonIdentity {
  businessName: string;
  partnerId: string;
  clientId: string;
  trustDocUrl: string;
  webhookUrl: string;
  identityActive: boolean;
  currentPhase: number;
  gatewayMode: string;
  gatewayStatus: string;
  capabilities: Array<{ id: string; name: string; description: string }>;
  peers: FalkonPeerSummary[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function healthColor(state: string): string {
  switch (state) {
    case "connected":
    case "healthy":
      return "#B4FF44";
    case "degraded":
    case "partial":
      return "#F59E0B";
    default:
      return "#435A7D";
  }
}

export function stateLabel(state: string): string {
  const map: Record<string, string> = {
    pending_delivery: "Queued",
    sent: "Sent",
    awaiting_approval: "Awaiting Approval",
    approved: "Approved",
    rejected: "Declined",
    cancelled: "Cancelled",
    fulfilled: "Complete",
    delivery_failed: "Delivery Failed",
    connected: "Connected",
    pending_peer: "Pending Peer",
    degraded: "Degraded",
    disconnected: "Disconnected",
  };
  return map[state] ?? state.replace(/_/g, " ");
}

export function stateBadgeClass(state: string): string {
  if (["fulfilled", "connected", "healthy"].includes(state))
    return "bg-[rgba(180,255,68,0.15)] text-[var(--gold)] border border-[rgba(180,255,68,0.3)]";
  if (["rejected", "cancelled", "delivery_failed", "disconnected"].includes(state))
    return "bg-[rgba(225,29,72,0.1)] text-[#E11D48] border border-[rgba(225,29,72,0.2)]";
  if (["degraded", "partial"].includes(state))
    return "bg-[rgba(245,158,11,0.12)] text-[#F59E0B] border border-[rgba(245,158,11,0.25)]";
  return "bg-[rgba(19,34,58,0.07)] text-[var(--muted)] border border-[var(--hairline)]";
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
