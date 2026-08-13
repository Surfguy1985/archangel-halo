import { useState, useEffect, useCallback } from "react";
import { useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type Mode = "OFF" | "SHADOW" | "ASSISTED" | "LIVE";

const MODE_COLORS: Record<Mode, string> = {
  OFF: "bg-slate-500",
  SHADOW: "bg-amber-500",
  ASSISTED: "bg-blue-500",
  LIVE: "bg-green-500",
};

const BASE = import.meta.env.BASE_URL as string;
const api = (path: string) => `${BASE}api${path}`;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(api(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`);
  return json as T;
}

// ─── Network Types ─────────────────────────────────────────────────────────────

interface NetworkPhase {
  phase: number;
  name: string;
  description: string;
  capabilities: Array<{ id: string; name: string; description: string }>;
  prerequisites: string[];
  whatThisUnlocks: string;
  enabled: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  readinessChecks: Array<{ id: string; label: string; pass: boolean; detail: string }>;
  ready: boolean;
}

interface NetworkIdentity {
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
  peers: Array<{ id: string; name: string; domain: string; healthState: string }>;
}

interface NetworkPeer {
  id: string;
  name: string;
  domain: string;
  trust_doc_url: string;
  capabilities_url: string;
  health_state: string;
  last_health_check_at: string | null;
  capabilities_data: { capabilities?: Array<{ id: string; name: string }> } | null;
  notes: string | null;
  created_at: string;
}

interface NetworkRequest {
  id: string;
  direction: "inbound" | "outbound";
  peer_name: string | null;
  capability_id: string;
  capability_name: string | null;
  correlation_id: string;
  approval_state: string;
  summary: string | null;
  shared_data_snapshot: Record<string, unknown> | null;
  request_events: Array<{ ts: number; event: string; detail: string }>;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  event_type: string;
  actor: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const [conn, setConn] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("https://archangel-halo.replit.app/api/falkon/webhook");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [partnerKey, setPartnerKey] = useState("falkon-gateway");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ connected: boolean; connection?: Record<string, unknown> }>("/falkon/connection");
      setConn(data.connected ? (data.connection ?? null) : null);
    } catch {
      setConn(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    if (!webhookUrl || !webhookSecret || !partnerKey) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    try {
      await apiFetch("/falkon/connect", {
        method: "POST",
        body: JSON.stringify({ partnerKey, webhookUrl, webhookSecret }),
      });
      toast({ title: "Connected — now run the 5-step verification" });
      void load();
    } catch (err: any) {
      toast({ title: "Connect failed", description: err.message, variant: "destructive" });
    }
  };

  const disconnect = async () => {
    try {
      await apiFetch("/falkon/connection", { method: "DELETE" });
      toast({ title: "Disconnected" });
      setConn(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  const mode = (conn?.mode ?? "SHADOW") as Mode;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Falkon Ops Integration
            {conn ? (
              <Badge className={`${MODE_COLORS[mode]} text-white`}>{mode}</Badge>
            ) : (
              <Badge variant="outline">Not Connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Enterprise S2S gateway — Ed25519-signed requests, make-ready pipeline, 22 capabilities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {conn ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{String(conn.status ?? "connected")}</dd>
                <dt className="text-muted-foreground">Verified At</dt>
                <dd>{conn.verifiedAt ? new Date(String(conn.verifiedAt)).toLocaleString() : "—"}</dd>
                <dt className="text-muted-foreground">Client ID</dt>
                <dd className="font-mono text-xs">fk_archangel_halo_prod</dd>
                <dt className="text-muted-foreground">Tenant</dt>
                <dd className="font-mono text-xs">archangel-halo-prod</dd>
                <dt className="text-muted-foreground">Gateway</dt>
                <dd className="font-mono text-xs truncate">building-blocks--austpryb1.replit.app</dd>
                <dt className="text-muted-foreground">Trust Doc</dt>
                <dd className="font-mono text-xs">/.well-known/falkon-trust.json</dd>
              </dl>
              <Button size="sm" variant="destructive" onClick={disconnect}>Disconnect</Button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Partner Key</Label>
                <Input className="h-8 text-sm font-mono" placeholder="falkon-gateway" value={partnerKey} onChange={(e) => setPartnerKey(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-0.5">Shared key from Falkon portal</p>
              </div>
              <div>
                <Label className="text-xs">Webhook URL (HALO's inbound endpoint)</Label>
                <Input className="h-8 text-sm font-mono" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Webhook Secret</Label>
                <Input className="h-8 text-sm font-mono" type="password" placeholder="Long random secret" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-0.5">HMAC signing secret for outbound events</p>
              </div>
              <Button onClick={connect}>Connect to Falkon Gateway</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Five-Step Verify Tab ─────────────────────────────────────────────────────

interface VerifyStatus {
  status: string;
  verifiedAt?: string;
  steps: Record<string, Record<string, unknown>>;
  mode: Mode;
  trustDocUrl: string;
  webhookUrl: string;
}

const VERIFY_STEPS = [
  { key: "step1", label: "Health Check", desc: "Can HALO reach the Falkon gateway?", path: "/falkon/admin/verify/1-health-check" },
  { key: "step2", label: "Trust Binding", desc: "Submit Ed25519 public key to gateway", path: "/falkon/admin/verify/2-trust-binding" },
  { key: "step3", label: "Register Callback", desc: "Tell Falkon where to send events", path: "/falkon/admin/verify/3-register-callback" },
  { key: "step4", label: "Shadow Execution", desc: "Run a dry-run pipeline probe", path: "/falkon/admin/verify/4-shadow-execution" },
  { key: "step5", label: "Ping Round-Trip", desc: "Confirm Falkon can call back to HALO", path: "/falkon/admin/verify/5-ping-roundtrip" },
];

function VerifyTab() {
  const [status, setStatus] = useState<VerifyStatus | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const { toast } = useToast();

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<VerifyStatus>("/falkon/admin/verify/status");
      setStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const runStep = async (step: typeof VERIFY_STEPS[number]) => {
    setRunning(step.key);
    try {
      const result = await apiFetch<Record<string, unknown>>(step.path, { method: "POST" });
      toast({ title: `Step: ${step.label}`, description: result.ok ? "✓ Passed" : "✗ Failed" });
    } catch (err: any) {
      toast({ title: `${step.label} failed`, description: err.message, variant: "destructive" });
    } finally {
      setRunning(null);
      void loadStatus();
    }
  };

  const runAll = async () => {
    for (const step of VERIFY_STEPS) {
      await runStep(step);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Five-Step Verification</CardTitle>
          <CardDescription>
            Complete all five steps to promote the connection to Verified status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && (
            <div className="flex items-center gap-2 mb-4">
              <Badge variant={status.status === "verified" ? "default" : "secondary"}>
                {status.status === "verified" ? "✓ Verified" : status.status}
              </Badge>
              {status.verifiedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(status.verifiedAt).toLocaleString()}
                </span>
              )}
            </div>
          )}

          <div className="space-y-2">
            {VERIFY_STEPS.map((step, i) => {
              const stepData = status?.steps?.[step.key];
              const pass = stepData?.ok === true;
              const ran = !!stepData;
              return (
                <div key={step.key} className="flex items-center gap-3 p-3 border rounded-lg">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                    ran ? (pass ? "bg-green-500" : "bg-red-500") : "bg-slate-300"
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                  {ran && !pass && (
                    <Badge variant="destructive" className="text-xs">Failed</Badge>
                  )}
                  {ran && pass && (
                    <Badge className="bg-green-500 text-white text-xs">Pass</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={running === step.key}
                    onClick={() => runStep(step)}
                  >
                    {running === step.key ? "Running…" : ran ? "Re-run" : "Run"}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={runAll} disabled={!!running}>
              {running ? "Running…" : "Run All Steps"}
            </Button>
            <Button variant="outline" onClick={loadStatus}>Refresh Status</Button>
          </div>

          {status && (
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>Trust Doc: <span className="font-mono">{status.trustDocUrl}</span></p>
              <p>Webhook: <span className="font-mono">{status.webhookUrl}</span></p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sync Tabs (Properties, Units, Vendors) ───────────────────────────────────

function SyncTab({ label, endpoint, description }: {
  label: string;
  endpoint: string;
  description: string;
}) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Record<string, unknown>>(endpoint, { method: "POST" });
      setResult(data);
      toast({ title: `${label} sync complete`, description: `${data.synced}/${data.total} synced` });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label} Twin Sync</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={run} disabled={loading}>
          {loading ? "Syncing…" : `Sync ${label}`}
        </Button>
        {result && (
          <div className="text-sm space-y-1">
            <p className="font-medium">
              {String(result.synced)} / {String(result.total)} synced
            </p>
            {Array.isArray(result.results) && result.results.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(result.results as { id: string; ok: boolean; action?: string }[])
                    .slice(0, 20)
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                        <TableCell>
                          <Badge className={r.ok ? "bg-green-500 text-white" : ""} variant={r.ok ? "default" : "destructive"}>
                            {r.ok ? r.action ?? "ok" : "failed"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BootstrapReport {
  ok: boolean;
  completedAt: string;
  steps: {
    properties: { synced: number; total: number; errors: string[] };
    units: { seeded: number; synced: number; totalProperties: number; errors: string[] };
    vendors: { synced: number; total: number; errors: string[] };
    capabilities: { ok: boolean; registered: number; error?: string };
  };
}
interface Capability {
  id: string;
  name: string;
  description: string;
  haloDataSource: string;
  status: "mapped" | "stub" | "unmapped";
  pipelineStage?: string;
  usage?: {
    total_calls: number;
    shadow_calls: number;
    errors: number;
    last_used: string | null;
  };
}

function CapabilitiesTab() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [registering, setRegistering] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ capabilities: Capability[] }>("/falkon/admin/capabilities");
      setCapabilities(data.capabilities);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const register = async () => {
    setRegistering(true);
    try {
      const data = await apiFetch<{ ok: boolean; registered: string[] }>("/falkon/admin/sync/capabilities", { method: "POST" });
      toast({ title: "Capabilities registered", description: `${data.registered?.length} registered with gateway` });
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setRegistering(false);
    }
  };

  const STATUS_COLORS = { mapped: "bg-green-500", stub: "bg-amber-500", unmapped: "bg-slate-400" };

  return (
    <Card>
      <CardHeader>
        <CardTitle>22-Capability Registry</CardTitle>
        <CardDescription>15 mapped to existing HALO data + 7 new Falkon-specific capabilities.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" onClick={register} disabled={registering}>
          {registering ? "Registering…" : "Register with Gateway"}
        </Button>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Capability</TableHead>
              <TableHead>HALO Source</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {capabilities.map((cap) => (
              <TableRow key={cap.id}>
                <TableCell>
                  <p className="font-medium text-sm">{cap.name}</p>
                  <p className="text-xs text-muted-foreground">{cap.description}</p>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-xs">{cap.haloDataSource}</TableCell>
                <TableCell className="text-xs">{cap.pipelineStage ?? "—"}</TableCell>
                <TableCell>
                  <Badge className={`${STATUS_COLORS[cap.status]} text-white text-xs`}>
                    {cap.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Make-Ready Tab ───────────────────────────────────────────────────────────

const MAKE_READY_PHASES = [
  "needs_turn", "scoping", "vendor_selection", "scheduled", "arriving",
  "before_photos", "work_in_progress", "after_photos", "qc_review",
  "invoice_validation", "approval_pending", "resident_ready",
];

interface Execution {
  id: string;
  property_name?: string;
  unit_label: string;
  phase: string;
  status: string;
  mode_at_start: string;
  started_at: string;
  completed_at?: string;
  resident_ready_at?: string;
}

function MakeReadyTab() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [advResult, setAdvResult] = useState<Record<string, unknown> | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [jobId, setJobId] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const { toast } = useToast();

  const loadList = useCallback(async () => {
    try {
      const data = await apiFetch<{ executions: Execution[] }>("/falkon/admin/make-ready");
      setExecutions(data.executions);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadDetail = async (id: string) => {
    setSelected(id);
    setAdvResult(null);
    try {
      const data = await apiFetch<Record<string, unknown>>(`/falkon/admin/make-ready/${id}`);
      setDetail(data);
    } catch { /* ignore */ }
  };

  const startExecution = async () => {
    if (!propertyId || !unitLabel) {
      toast({ title: "Property ID and Unit Label required", variant: "destructive" });
      return;
    }
    try {
      const data = await apiFetch<{ executionId: string }>("/falkon/admin/make-ready/start", {
        method: "POST",
        body: JSON.stringify({ propertyId, unitLabel, jobId: jobId || undefined }),
      });
      toast({ title: "Execution started", description: `ID: ${data.executionId.slice(0, 8)}…` });
      void loadList();
    } catch (err: any) {
      toast({ title: "Start failed", description: err.message, variant: "destructive" });
    }
  };

  const advance = async () => {
    if (!selected) return;
    setAdvancing(true);
    try {
      const result = await apiFetch<Record<string, unknown>>(`/falkon/admin/make-ready/${selected}/advance`, { method: "POST" });
      setAdvResult(result);
      if (result.advanced) {
        toast({ title: `Advanced → ${result.toPhase}` });
      } else {
        toast({ title: "Blocked gates", description: `${(result.blockedGates as unknown[])?.length} gate(s) not met`, variant: "destructive" });
      }
      void loadList();
      void loadDetail(selected);
    } catch (err: any) {
      toast({ title: "Advance failed", description: err.message, variant: "destructive" });
    } finally {
      setAdvancing(false);
    }
  };

  const phaseIdx = (phase: string) => MAKE_READY_PHASES.indexOf(phase);

  return (
    <div className="grid grid-cols-5 gap-4">
      <div className="col-span-2 space-y-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Start Execution</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">Property ID</Label>
              <Input className="text-xs h-7" placeholder="uuid" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Unit Label</Label>
              <Input className="text-xs h-7" placeholder="101A" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Job ID (optional)</Label>
              <Input className="text-xs h-7" placeholder="uuid" value={jobId} onChange={(e) => setJobId(e.target.value)} />
            </div>
            <Button size="sm" className="w-full" onClick={startExecution}>Start</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Executions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-80 overflow-y-auto">
              {executions.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3">No executions yet</p>
              ) : executions.map((ex) => (
                <button
                  key={ex.id}
                  className={`w-full text-left px-3 py-2 border-b text-xs hover:bg-muted transition-colors ${selected === ex.id ? "bg-muted" : ""}`}
                  onClick={() => loadDetail(ex.id)}
                >
                  <p className="font-medium">{ex.unit_label} — {ex.property_name ?? ex.id.slice(0, 8)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className="text-[10px] h-4">{ex.phase}</Badge>
                    <span className="text-muted-foreground">{ex.mode_at_start}</span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="col-span-3 space-y-3">
        {detail ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center justify-between">
                <span>{String(detail.unit_label)} — Pipeline</span>
                <Button size="sm" onClick={advance} disabled={advancing || detail.status === "completed"}>
                  {advancing ? "Advancing…" : "Advance Phase"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-1 flex-wrap">
                {MAKE_READY_PHASES.map((ph, i) => {
                  const current = phaseIdx(String(detail.phase ?? "needs_turn"));
                  const done = i < current;
                  const active = i === current;
                  return (
                    <div key={ph} className={`h-1.5 flex-1 rounded-full ${done ? "bg-green-500" : active ? "bg-amber-400" : "bg-slate-200"}`} title={ph} />
                  );
                })}
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Phase {phaseIdx(String(detail.phase ?? "")) + 1} / 12 — <strong>{String(detail.phase)}</strong>
              </p>

              {advResult && (
                <div className={`text-xs p-2 rounded border ${advResult.advanced ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
                  {advResult.advanced
                    ? `✓ Advanced to ${String(advResult.toPhase)}`
                    : `Blocked: ${(advResult.blockedGates as { id: string }[])?.map((g) => g.id).join(", ")}`}
                </div>
              )}

              {Array.isArray((detail as any).gates_snapshot) && (detail as any).gates_snapshot.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Gate Snapshot</p>
                  {((detail as any).gates_snapshot as { id: string; name: string; pass: boolean; detail: string }[]).map((g) => (
                    <div key={g.id} className={`flex items-start gap-2 text-xs p-2 rounded border ${g.pass ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                      <span className="mt-0.5 flex-shrink-0">{g.pass ? "✓" : "✗"}</span>
                      <div>
                        <p className="font-medium">{g.name}</p>
                        <p className="text-muted-foreground">{g.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {Array.isArray(detail.events) && detail.events.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium">Event Log</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(detail.events as { id: string; event_kind: string; from_phase?: string; to_phase?: string; created_at: string }[])
                      .slice(-10).reverse().map((ev) => (
                      <div key={ev.id} className="text-xs flex gap-2 items-start">
                        <span className="text-muted-foreground flex-shrink-0">{new Date(ev.created_at).toLocaleTimeString()}</span>
                        <span className="font-mono">{ev.event_kind}</span>
                        {ev.from_phase && ev.to_phase && (
                          <span className="text-muted-foreground">{ev.from_phase} → {ev.to_phase}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Select an execution to view pipeline details
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Inbound Events Tab ───────────────────────────────────────────────────────

interface InboundEvent {
  id: string;
  event_type: string;
  jti: string;
  processed: boolean;
  received_at: string;
}

function InboundEventsTab() {
  const [events, setEvents] = useState<InboundEvent[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ events: InboundEvent[] }>("/falkon/admin/inbound-events");
      setEvents(data.events ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound Events</CardTitle>
        <CardDescription>Events received from the Falkon gateway via webhook.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No inbound events yet. Complete verification step 5 to trigger the first ping-back.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event Type</TableHead>
                <TableHead>JTI</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Processed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell className="font-mono text-xs">{ev.event_type}</TableCell>
                  <TableCell className="font-mono text-xs">{ev.jti?.slice(0, 16)}…</TableCell>
                  <TableCell className="text-xs">{new Date(ev.received_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge className={ev.processed ? "bg-green-500 text-white" : ""} variant={ev.processed ? "default" : "secondary"}>
                      {ev.processed ? "✓" : "Pending"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Usage Metering Tab ───────────────────────────────────────────────────────

function UsageTab() {
  const [capabilities, setCapabilities] = useState<(Capability & { usage: NonNullable<Capability["usage"]> })[]>([]);
  const [daily, setDaily] = useState<Record<string, unknown>[]>([]);
  const [view, setView] = useState<"summary" | "daily">("summary");

  useEffect(() => {
    apiFetch<{ capabilities: typeof capabilities }>("/falkon/admin/usage")
      .then((d) => setCapabilities(d.capabilities))
      .catch(() => {});
    apiFetch<{ daily: Record<string, unknown>[] }>("/falkon/admin/usage/daily?days=14")
      .then((d) => setDaily(d.daily))
      .catch(() => {});
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage Metering</CardTitle>
        <CardDescription>30-day rolling call counts by capability.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button size="sm" variant={view === "summary" ? "default" : "outline"} onClick={() => setView("summary")}>Summary</Button>
          <Button size="sm" variant={view === "daily" ? "default" : "outline"} onClick={() => setView("daily")}>Daily</Button>
        </div>

        {view === "summary" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead className="text-right">Calls (30d)</TableHead>
                <TableHead className="text-right">Shadow</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead>Last Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capabilities.map((cap) => (
                <TableRow key={cap.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{cap.name}</p>
                    <Badge className="text-[10px] mt-0.5" variant="outline">{cap.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{cap.usage?.total_calls ?? 0}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{cap.usage?.shadow_calls ?? 0}</TableCell>
                  <TableCell className="text-right">
                    {(cap.usage?.errors ?? 0) > 0 ? (
                      <span className="text-red-500 font-mono">{cap.usage?.errors}</span>
                    ) : <span className="font-mono text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {cap.usage?.last_used ? new Date(cap.usage.last_used).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {view === "daily" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Capability</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Shadow</TableHead>
                <TableHead className="text-right">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daily.slice(0, 50).map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{String(row.date)}</TableCell>
                  <TableCell className="text-xs font-mono">{String(row.capability)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{String(row.calls)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{String(row.shadow_calls)}</TableCell>
                  <TableCell className="text-right text-xs">{String(row.error_count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Eligibility Tab ──────────────────────────────────────────────────────────

interface EligibilityCheck { id: string; label: string; pass: boolean; detail: string; }
interface EligibilityResult {
  currentMode: Mode;
  nextMode: Mode | null;
  eligibleToPromote: boolean;
  checks: EligibilityCheck[];
}

function EligibilityTab() {
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [showBootstrap, setShowBootstrap] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EligibilityResult>("/falkon/admin/eligibility");
      setResult(data);
    } catch (err: any) {
      toast({ title: "Failed to load eligibility", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const promote = async () => {
    if (!result?.nextMode) return;
    setPromoting(true);
    try {
      await apiFetch("/falkon/admin/eligibility/promote", {
        method: "POST",
        body: JSON.stringify({ targetMode: result.nextMode }),
      });
      toast({ title: `Promoted to ${result.nextMode}` });
      // Auto-trigger bootstrap sync after a successful promote-to-ASSISTED
      if (result.nextMode === "ASSISTED") {
        setShowBootstrap(true);
      }
      void load();
    } catch (err: any) {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>LIVE Eligibility & Mode Promotion</CardTitle>
        <CardDescription>
          All checks must pass before promoting from SHADOW → ASSISTED → LIVE.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {result && (
            <>
              <Badge className={`${MODE_COLORS[result.currentMode]} text-white`}>
                Current: {result.currentMode}
              </Badge>
              {result.nextMode && (
                <Badge variant="outline">Next: {result.nextMode}</Badge>
              )}
            </>
          )}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Check Eligibility"}
          </Button>
          {result?.eligibleToPromote && result.nextMode && (
            <Button size="sm" onClick={promote} disabled={promoting}>
              {promoting ? "Promoting…" : `Promote to ${result.nextMode}`}
            </Button>
          )}
        </div>

        {result && (
          <div className="space-y-2">
            {result.checks.map((check) => (
              <div
                key={check.id}
                className={`flex items-start gap-3 p-3 border rounded-lg ${check.pass ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
              >
                <span className={`text-lg flex-shrink-0 ${check.pass ? "text-green-600" : "text-red-500"}`}>
                  {check.pass ? "✓" : "✗"}
                </span>
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {!result && !loading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Click "Check Eligibility" to run all eligibility checks.
          </p>
        )}
      </CardContent>
    </Card>

    {/* Bootstrap sync notification — server triggers it automatically on promote */}
    {showBootstrap && (
      <div className="mt-4 flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
        <span className="text-blue-600 text-xl flex-shrink-0">⚡</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">Bootstrap sync triggered</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Promoted to ASSISTED — the server is now pushing all property, unit, vendor, and capability twins to the Falkon gateway in the background.
            Use the <strong>Bootstrap Sync</strong> tab to check results or re-run manually.
          </p>
        </div>
      </div>
    )}
  </div>
  );
}

// ─── Phase Roadmap Tab ─────────────────────────────────────────────────────────

type CmdState = "idle" | "checking" | "blocked" | "awaiting_confirm" | "activating" | "done" | "error";

function PhaseRoadmapTab() {
  const [phases, setPhases] = useState<NetworkPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [cmd, setCmd] = useState("");
  const [cmdPhase, setCmdPhase] = useState<number | null>(null);
  const [cmdState, setCmdState] = useState<CmdState>("idle");
  const [cmdError, setCmdError] = useState("");
  const [checkResult, setCheckResult] = useState<NetworkPhase | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [rollbackPhase, setRollbackPhase] = useState<number | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState("");
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ phases: NetworkPhase[] }>("/falkon/network/phases");
      setPhases(data.phases ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submitCommand = async () => {
    const match = /^go\s+phase\s+([1-6])$/i.exec(cmd.trim());
    if (!match) {
      setCmdError("Unrecognized command. Try: GO PHASE 2");
      return;
    }
    const n = parseInt(match[1]!, 10);
    const phase = phases.find((p) => p.phase === n);
    if (phase?.enabled) {
      setCmdError(`Phase ${n} is already active`);
      return;
    }
    setCmdPhase(n);
    setCmdState("checking");
    setCmdError("");
    setCheckResult(null);
    try {
      const data = await apiFetch<{ phases: NetworkPhase[] }>("/falkon/network/phases");
      const target = data.phases.find((p) => p.phase === n) ?? null;
      setCheckResult(target);
      setPhases(data.phases);
      if (!target?.ready) {
        setCmdState("blocked");
      } else {
        setCmdState("awaiting_confirm");
        setConfirmInput("");
      }
    } catch (err: any) {
      setCmdState("error");
      setCmdError(err.message ?? "Failed to check readiness");
    }
  };

  const activate = async () => {
    if (!cmdPhase || !checkResult) return;
    if (cmdPhase >= 3 && confirmInput !== `ACTIVATE PHASE ${cmdPhase}`) {
      setCmdError(`Type exactly: ACTIVATE PHASE ${cmdPhase}`);
      return;
    }
    setCmdState("activating");
    try {
      await apiFetch(`/falkon/network/phases/${cmdPhase}/activate`, { method: "POST" });
      setCmdState("done");
      setCmd("");
      toast({ title: `Phase ${cmdPhase} — ${checkResult.name} activated` });
      void load();
    } catch (err: any) {
      setCmdState("error");
      setCmdError(err.message ?? "Activation failed");
    }
  };

  const doRollback = async (phase: number) => {
    if (rollbackConfirm.trim().toUpperCase() !== "ROLLBACK") {
      toast({ title: "Type ROLLBACK to confirm", variant: "destructive" });
      return;
    }
    try {
      await apiFetch(`/falkon/network/phases/${phase}/rollback`, { method: "POST" });
      toast({ title: `Phase ${phase} rolled back` });
      setRollbackPhase(null);
      setRollbackConfirm("");
      void load();
    } catch (err: any) {
      toast({ title: "Rollback failed", description: err.message, variant: "destructive" });
    }
  };

  const resetCmd = () => {
    setCmdState("idle");
    setCmdError("");
    setCheckResult(null);
    setCmdPhase(null);
    setConfirmInput("");
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground p-4">Loading phase roadmap…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Six-phase vertical stepper */}
      <div className="space-y-2">
        {phases.map((phase, i) => {
          const isActive = phase.enabled;
          const isLast = i === phases.length - 1;
          const isExpanded = expandedPhase === phase.phase || isActive;

          return (
            <div key={phase.phase} className="flex gap-4">
              {/* Connector column */}
              <div className="flex flex-col items-center flex-shrink-0 w-8">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    isActive
                      ? "bg-[#B4FF44] text-black ring-4 ring-[#B4FF44]/30 shadow-[0_0_12px_rgba(180,255,68,0.4)]"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {phase.phase}
                </div>
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-3 mt-1 transition-colors ${isActive ? "bg-[#B4FF44]/60" : "bg-border"}`} />
                )}
              </div>

              {/* Phase card */}
              <div
                className={`flex-1 mb-${isLast ? "0" : "2"} rounded-xl border transition-all ${
                  isActive
                    ? "border-[#B4FF44]/40 bg-gradient-to-br from-[#B4FF44]/5 to-transparent"
                    : "border-border bg-card"
                }`}
              >
                {/* Card header — always visible */}
                <button
                  type="button"
                  className="w-full text-left p-4 pb-3"
                  onClick={() => setExpandedPhase(isExpanded && !isActive ? null : phase.phase)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">Phase {phase.phase} — {phase.name}</span>
                      {isActive ? (
                        <Badge className="bg-[#B4FF44] text-black text-xs font-bold">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Dormant</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Rollback trigger — active non-phase-1 only */}
                      {isActive && phase.phase > 1 && rollbackPhase !== phase.phase && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="text-xs h-7"
                          onClick={(e) => { e.stopPropagation(); setRollbackPhase(phase.phase); setRollbackConfirm(""); }}
                        >
                          Rollback
                        </Button>
                      )}
                      <span className="text-muted-foreground text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{phase.description}</p>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Rollback confirmation */}
                    {rollbackPhase === phase.phase && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2">
                        <p className="text-xs font-semibold text-red-800">
                          This will disable Phase {phase.phase}. This action is audited and irreversible without re-activation.
                        </p>
                        <p className="text-xs text-red-700">Type <code className="bg-red-100 px-1 rounded font-mono">ROLLBACK</code> to confirm:</p>
                        <div className="flex gap-2">
                          <Input
                            className="h-8 text-sm font-mono border-red-300 focus:border-red-500"
                            placeholder="ROLLBACK"
                            value={rollbackConfirm}
                            onChange={(e) => setRollbackConfirm(e.target.value)}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={rollbackConfirm.trim().toUpperCase() !== "ROLLBACK"}
                            onClick={() => doRollback(phase.phase)}
                          >
                            Confirm Rollback
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRollbackPhase(null); setRollbackConfirm(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Capabilities chips */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Capabilities</p>
                      <div className="flex flex-wrap gap-1.5">
                        {phase.capabilities.map((cap) => (
                          <Badge key={cap.id} variant="secondary" className="text-xs">
                            {cap.name}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Readiness checks */}
                    {phase.readinessChecks.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Readiness Checks</p>
                        {phase.readinessChecks.map((check) => (
                          <div
                            key={check.id}
                            className={`flex items-start gap-2 text-xs p-2 rounded-lg border ${
                              check.pass
                                ? "border-green-200 bg-green-50 text-green-800"
                                : "border-red-200 bg-red-50 text-red-800"
                            }`}
                          >
                            <span className="flex-shrink-0 font-bold mt-px">{check.pass ? "✓" : "✗"}</span>
                            <div>
                              <span className="font-medium">{check.label}</span>
                              <span className="text-muted-foreground ml-1">— {check.detail}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Prerequisites for dormant */}
                    {!isActive && phase.prerequisites.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Prerequisites</p>
                        <ul className="space-y-0.5">
                          {phase.prerequisites.map((prereq, pi) => (
                            <li key={pi} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/40 flex-shrink-0 mt-1.5" />
                              {prereq}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* What this unlocks */}
                    {!isActive && phase.whatThisUnlocks && (
                      <div className="p-3 rounded-lg bg-muted/40 border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">What this unlocks</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{phase.whatThisUnlocks}</p>
                      </div>
                    )}

                    {/* Activated metadata */}
                    {isActive && phase.activatedAt && (
                      <p className="text-xs text-muted-foreground border-t pt-2">
                        Activated {new Date(phase.activatedAt).toLocaleString()} by {phase.activatedBy ?? "operator"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* GO PHASE X operator command */}
      <Card className="border-2">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Operator Command
            <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">GO PHASE N</code>
          </CardTitle>
          <CardDescription className="text-xs">
            Activate a Falkon Network phase. Phases 3+ require typed confirmation before activation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cmdState === "idle" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  className="font-mono text-sm uppercase tracking-wider"
                  placeholder="GO PHASE 2"
                  value={cmd}
                  onChange={(e) => { setCmd(e.target.value); setCmdError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && void submitCommand()}
                />
                <Button onClick={() => void submitCommand()} disabled={!cmd.trim()}>
                  Execute
                </Button>
              </div>
              {cmdError && <p className="text-xs text-red-600">{cmdError}</p>}
            </div>
          )}

          {cmdState === "checking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-3 h-3 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
              Checking readiness for Phase {cmdPhase}…
            </div>
          )}

          {cmdState === "blocked" && checkResult && (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm font-semibold text-red-800 mb-2">
                  Phase {cmdPhase} — prerequisites not met
                </p>
                <div className="space-y-1.5">
                  {checkResult.readinessChecks.filter((c) => !c.pass).map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs text-red-700">
                      <span className="font-bold flex-shrink-0">✗</span>
                      <div>
                        <span className="font-medium">{c.label}</span>
                        <span className="text-red-500 ml-1">— {c.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={resetCmd}>← Try again</Button>
            </div>
          )}

          {cmdState === "awaiting_confirm" && checkResult && (
            <div className="space-y-3">
              <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                <p className="text-sm font-semibold text-green-800">
                  ✓ All checks pass for Phase {cmdPhase} — {checkResult.name}
                </p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {checkResult.capabilities.map((c) => (
                    <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>
                  ))}
                </div>
              </div>

              {(cmdPhase ?? 0) >= 3 ? (
                <div className="space-y-2 p-4 rounded-lg border-2 border-amber-300 bg-amber-50">
                  <p className="text-sm font-bold text-amber-900">
                    Phase {cmdPhase} activation requires confirmation.
                  </p>
                  <p className="text-xs text-amber-800">
                    Type exactly: <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono font-bold">ACTIVATE PHASE {cmdPhase}</code>
                  </p>
                  <div className="flex gap-2">
                    <Input
                      className="font-mono text-sm border-amber-400 focus:border-amber-600"
                      placeholder={`ACTIVATE PHASE ${cmdPhase}`}
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      autoFocus
                    />
                    <Button
                      onClick={() => void activate()}
                      disabled={confirmInput !== `ACTIVATE PHASE ${cmdPhase}`}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
                    >
                      Activate
                    </Button>
                  </div>
                  {cmdError && <p className="text-xs text-red-600">{cmdError}</p>}
                  <Button variant="ghost" size="sm" onClick={resetCmd} className="text-muted-foreground">
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={() => void activate()} className="bg-[#B4FF44] text-black hover:bg-[#a4ef34] font-bold">
                    Activate Phase {cmdPhase}
                  </Button>
                  <Button variant="outline" onClick={resetCmd}>Cancel</Button>
                </div>
              )}
            </div>
          )}

          {cmdState === "activating" && (
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full border-2 border-[#B4FF44] border-t-transparent animate-spin" />
              Activating Phase {cmdPhase}…
            </div>
          )}

          {cmdState === "done" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
                <span className="text-lg">✓</span>
                Phase {cmdPhase} activated successfully
              </div>
              <Button variant="outline" size="sm" onClick={resetCmd}>Run another command</Button>
            </div>
          )}

          {cmdState === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-red-600 font-medium">{cmdError}</p>
              <Button variant="outline" size="sm" onClick={resetCmd}>← Try again</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Network Identity Tab ──────────────────────────────────────────────────────

function NetworkIdentityTab() {
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NetworkIdentity>("/falkon/network/identity");
      setIdentity(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copied` }));
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading identity…</p>;
  if (!identity) return <p className="text-sm text-red-500 p-4">Failed to load identity. Ensure the server is running.</p>;

  return (
    <div className="space-y-4">
      {/* Dark identity hero card */}
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-[#B4FF44]/20 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle,rgba(180,255,68,0.08)_0%,transparent_70%)] pointer-events-none" />

        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-white">
            <div className="w-11 h-11 rounded-xl bg-[#B4FF44]/10 border border-[#B4FF44]/30 flex items-center justify-center flex-shrink-0">
              <span className="text-[#B4FF44] font-black text-xl">F</span>
            </div>
            <div>
              <div className="text-base font-bold">{identity.businessName}</div>
              <div className="text-xs text-slate-400 font-normal font-mono">{identity.partnerId}</div>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5">
              {identity.identityActive ? (
                <Badge className="bg-[#B4FF44] text-black text-xs font-bold">Identity Active</Badge>
              ) : (
                <Badge variant="destructive" className="text-xs">No Identity</Badge>
              )}
              <Badge className="bg-[#B4FF44]/20 text-[#B4FF44] border border-[#B4FF44]/30 text-xs">
                Phase {identity.currentPhase}
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-400">Client ID</dt>
            <dd className="font-mono text-xs text-slate-200 truncate">{identity.clientId}</dd>
            <dt className="text-slate-400">Gateway Mode</dt>
            <dd>
              <Badge
                className={`${MODE_COLORS[identity.gatewayMode as Mode] ?? "bg-slate-500"} text-white text-xs`}
              >
                {identity.gatewayMode}
              </Badge>
            </dd>
            <dt className="text-slate-400">Gateway Status</dt>
            <dd className="text-slate-200 text-sm capitalize">{identity.gatewayStatus}</dd>
            <dt className="text-slate-400">Peers</dt>
            <dd className="text-slate-200">{identity.peers?.length ?? 0}</dd>
          </dl>

          {/* Trust doc URL row */}
          <div className="pt-3 border-t border-slate-700 space-y-2">
            <div>
              <p className="text-xs text-slate-400 mb-1">Trust Document URL</p>
              <div className="flex items-center gap-2">
                <p className="text-xs font-mono text-slate-200 flex-1 truncate bg-slate-800 px-2 py-1.5 rounded border border-slate-700">
                  {identity.trustDocUrl}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 border-slate-600 text-slate-300 hover:bg-slate-700 flex-shrink-0"
                  onClick={() => copy(identity.trustDocUrl, "Trust doc URL")}
                >
                  Copy
                </Button>
                <a href={identity.trustDocUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="text-xs h-7 border-slate-600 text-slate-300 hover:bg-slate-700 flex-shrink-0">
                    Open ↗
                  </Button>
                </a>
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-400 mb-1">Webhook URL</p>
              <div className="flex items-center gap-2">
                <p className="text-xs font-mono text-slate-200 flex-1 truncate bg-slate-800 px-2 py-1.5 rounded border border-slate-700">
                  {identity.webhookUrl}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 border-slate-600 text-slate-300 hover:bg-slate-700 flex-shrink-0"
                  onClick={() => copy(identity.webhookUrl, "Webhook URL")}
                >
                  Copy
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase 1 capabilities */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Phase 1 Capabilities — Published</CardTitle>
          <CardDescription className="text-xs">
            These capabilities are registered with the Falkon Network and discoverable by any verified peer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identity.capabilities.length === 0 ? (
            <p className="text-xs text-muted-foreground">No capabilities loaded yet. Run Step 4 of the verification flow.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {identity.capabilities.map((cap) => (
                <div key={cap.id} className="p-3 rounded-lg bg-muted/40 border">
                  <p className="text-xs font-semibold">{cap.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{cap.description}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Peers summary */}
      {identity.peers?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Connected Peers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {identity.peers.map((peer) => {
                const healthColor = {
                  connected: "bg-green-500",
                  degraded: "bg-amber-500",
                  disconnected: "bg-red-500",
                  pending_peer: "bg-slate-400",
                }[peer.healthState] ?? "bg-slate-400";
                return (
                  <div key={peer.id} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                    <div className={`w-2 h-2 rounded-full ${healthColor} flex-shrink-0`} />
                    <span className="text-sm font-medium">{peer.name}</span>
                    <span className="text-xs text-muted-foreground">{peer.domain}</span>
                    <Badge variant="outline" className="text-xs ml-auto">{peer.healthState}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Peer Management Tab ──────────────────────────────────────────────────────

function PeerManagementTab() {
  const [peers, setPeers] = useState<NetworkPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ peers: NetworkPeer[] }>("/falkon/network/peers");
      setPeers(data.peers ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshPeer = async (id: string) => {
    setRefreshing(id);
    try {
      const data = await apiFetch<{ ok: boolean; newState: string }>(
        `/falkon/network/peers/${id}/refresh`,
        { method: "POST" },
      );
      toast({ title: `Health updated: ${data.newState}` });
      void load();
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setRefreshing(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading peers…</p>;

  const HEALTH_COLORS: Record<string, string> = {
    connected: "bg-green-500 text-white",
    degraded: "bg-amber-500 text-white",
    disconnected: "bg-red-500 text-white",
    pending_peer: "bg-slate-400 text-white",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            {peers.length} Registered Peer{peers.length !== 1 ? "s" : ""}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Health checks run every 15 minutes automatically
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>Refresh All</Button>
      </div>

      {peers.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No peers registered.</p>
            <p className="text-xs text-muted-foreground mt-1">
              UR Founders should appear here after schema bootstrap. Check server logs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {peers.map((peer) => {
            const isURFounders = peer.domain === "urfounders.com";
            const caps = peer.capabilities_data?.capabilities ?? [];
            const state = peer.health_state;

            return (
              <Card key={peer.id}>
                <CardContent className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {isURFounders && (
                        <div className="w-11 h-11 rounded-xl bg-[#B4FF44]/10 border border-[#B4FF44]/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-[#6D9B12] font-black text-sm">URF</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold">{peer.name}</p>
                          <Badge className={`${HEALTH_COLORS[state] ?? "bg-slate-400 text-white"} text-xs`}>
                            {state === "pending_peer" ? "Pending Peer" : state.charAt(0).toUpperCase() + state.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{peer.domain}</p>
                        {peer.notes && (
                          <p className="text-xs text-muted-foreground/70 mt-1 italic">{peer.notes}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={refreshing === peer.id}
                      onClick={() => refreshPeer(peer.id)}
                      className="flex-shrink-0"
                    >
                      {refreshing === peer.id ? "Checking…" : "Force Refresh"}
                    </Button>
                  </div>

                  {/* Pending peer animation */}
                  {state === "pending_peer" && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <div className="flex gap-0.5">
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </div>
                      Pending Peer — attempting to reach trust document every 15 minutes
                    </div>
                  )}

                  {/* Capabilities from cached data */}
                  {caps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {caps.slice(0, 5).map((c) => (
                        <Badge key={c.id} variant="outline" className="text-xs">{c.name}</Badge>
                      ))}
                      {caps.length > 5 && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">+{caps.length - 5} more</Badge>
                      )}
                    </div>
                  )}

                  {/* Footer metadata */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
                    <span className="font-mono truncate max-w-xs">{peer.trust_doc_url}</span>
                    <span className="flex-shrink-0 ml-2">
                      {peer.last_health_check_at
                        ? `Checked ${new Date(peer.last_health_check_at).toLocaleTimeString()}`
                        : "Not yet checked"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Request Inbox Tab ────────────────────────────────────────────────────────

function RequestInboxTab() {
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"inbound" | "outbound">("inbound");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ requests: NetworkRequest[] }>("/falkon/network/requests");
      setRequests(data.requests ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 15 s
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const approve = async (id: string) => {
    setActing(id);
    try {
      await apiFetch(`/falkon/network/requests/${id}/approve`, { method: "POST" });
      toast({ title: "Request approved" });
      void load();
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const reject = async (id: string) => {
    setActing(id);
    try {
      await apiFetch(`/falkon/network/requests/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason }),
      });
      toast({ title: "Request rejected" });
      setRejectReason("");
      void load();
    } catch (err: any) {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const retry = async (id: string) => {
    setActing(id);
    try {
      await apiFetch(`/falkon/network/requests/${id}/retry`, { method: "POST" });
      toast({ title: "Queued for retry" });
      void load();
    } catch (err: any) {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const STATE_BADGE: Record<string, string> = {
    pending_delivery: "bg-amber-500 text-white",
    sent: "bg-blue-500 text-white",
    awaiting_approval: "bg-orange-500 text-white",
    approved: "bg-green-500 text-white",
    rejected: "bg-red-500 text-white",
    cancelled: "bg-slate-400 text-white",
    fulfilled: "bg-emerald-500 text-white",
    delivery_failed: "bg-red-600 text-white",
  };

  const filtered = requests.filter((r) => r.direction === tab);
  const pendingInbound = requests.filter(
    (r) => r.direction === "inbound" && r.approval_state === "awaiting_approval",
  ).length;

  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading requests…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {(["inbound", "outbound"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? "default" : "outline"}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5"
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "inbound" && pendingInbound > 0 && (
                <Badge className="bg-orange-500 text-white text-xs ml-1 h-4 px-1">{pendingInbound}</Badge>
              )}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No {tab} requests yet</p>
            {tab === "outbound" && (
              <p className="text-xs text-muted-foreground mt-1">
                Use Ask Falkon in the office app to send your first request
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((req) => {
            const isExpanded = expanded === req.id;
            const canApprove = req.direction === "inbound" && req.approval_state === "awaiting_approval";
            const canRetry = req.direction === "outbound" && req.approval_state === "delivery_failed";
            const canReject = canApprove;

            return (
              <Card key={req.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">
                          {req.capability_name ?? req.capability_id}
                        </p>
                        <Badge className={`${STATE_BADGE[req.approval_state] ?? "bg-slate-400 text-white"} text-xs`}>
                          {req.approval_state.replace(/_/g, " ")}
                        </Badge>
                        {canApprove && (
                          <Badge className="bg-orange-100 text-orange-700 border border-orange-300 text-xs">
                            Action required
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {req.peer_name ?? "Unknown peer"} · {new Date(req.created_at).toLocaleString()}
                      </p>
                      {req.summary && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">{req.summary}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-shrink-0"
                      onClick={() => setExpanded(isExpanded ? null : req.id)}
                    >
                      {isExpanded ? "Collapse" : "Details"}
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t pt-3">
                      {/* Shared data disclosure */}
                      {req.shared_data_snapshot && (
                        <div>
                          <p className="text-xs font-semibold mb-1.5">Shared Data (read-only)</p>
                          <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-36 font-mono leading-relaxed">
                            {JSON.stringify(req.shared_data_snapshot, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Event history */}
                      {req.request_events?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1.5">Event History</p>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {req.request_events.map((ev, i) => (
                              <div key={i} className="text-xs flex gap-2 items-start">
                                <span className="text-muted-foreground flex-shrink-0 font-mono">
                                  {new Date(ev.ts).toLocaleTimeString()}
                                </span>
                                <span className="font-mono text-blue-600 font-medium">{ev.event}</span>
                                <span className="text-muted-foreground">{ev.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Error display */}
                      {req.last_error && (
                        <div className="p-2 rounded-lg bg-red-50 border border-red-200">
                          <p className="text-xs text-red-700 font-medium">Last error</p>
                          <p className="text-xs text-red-600 mt-0.5">{req.last_error}</p>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 items-start pt-1">
                        {canApprove && (
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            disabled={acting === req.id}
                            onClick={() => void approve(req.id)}
                          >
                            {acting === req.id ? "Approving…" : "Approve Request"}
                          </Button>
                        )}
                        {canReject && (
                          <div className="flex gap-1.5 items-center">
                            <Input
                              className="h-8 text-xs w-44"
                              placeholder="Rejection reason (optional)"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={acting === req.id}
                              onClick={() => void reject(req.id)}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={acting === req.id}
                            onClick={() => void retry(req.id)}
                          >
                            {acting === req.id ? "Queuing…" : "Retry Delivery"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

const AUDIT_EVENT_STYLES: Record<string, string> = {
  "phase.activated": "text-lime-700 bg-lime-50 border-lime-200",
  "phase.rolled_back": "text-red-700 bg-red-50 border-red-200",
  "peer.registered": "text-blue-700 bg-blue-50 border-blue-200",
  "peer.removed": "text-red-700 bg-red-50 border-red-200",
  "peer.health_changed": "text-amber-700 bg-amber-50 border-amber-200",
  "request.delivered": "text-green-700 bg-green-50 border-green-200",
  "request.created": "text-purple-700 bg-purple-50 border-purple-200",
  "request.approved": "text-emerald-700 bg-emerald-50 border-emerald-200",
  "request.rejected": "text-red-700 bg-red-50 border-red-200",
  "request.cancelled": "text-slate-700 bg-slate-50 border-slate-200",
};

const AUDIT_PAGE_SIZE = 20;

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const data = await apiFetch<{ audit: AuditEntry[]; total: number }>(
          `/falkon/network/audit?limit=${AUDIT_PAGE_SIZE}&offset=${p * AUDIT_PAGE_SIZE}`,
        );
        setEntries(data.audit ?? []);
        setTotal(data.total ?? 0);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => { void load(page); }, [load, page]);

  const totalPages = Math.ceil(total / AUDIT_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Append-Only Audit Log</h3>
          <p className="text-xs text-muted-foreground">{total} total entries — no deletions or edits</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load(page)}>Refresh</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading audit log…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No audit entries yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Peer health changes, phase activations, and request approvals will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => {
            const style = AUDIT_EVENT_STYLES[entry.event_type] ?? "text-slate-600 bg-slate-50 border-slate-200";
            const isExpanded = expanded === entry.id;

            return (
              <div
                key={entry.id}
                className={`rounded-lg border p-3 transition-colors ${
                  i % 2 === 0 ? "bg-card" : "bg-muted/20"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded border ${style}`}>
                        {entry.event_type}
                      </span>
                      <Badge variant="outline" className="text-xs">{entry.actor}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs mt-1 font-medium">{entry.summary}</p>
                    {entry.entity_id && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {entry.entity_type}: {entry.entity_id.slice(0, 8)}…
                      </p>
                    )}
                  </div>
                  {entry.payload && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-6 px-2 flex-shrink-0"
                      onClick={() => setExpanded(isExpanded ? null : entry.id)}
                    >
                      {isExpanded ? "▲ Hide" : "▼ Payload"}
                    </Button>
                  )}
                </div>

                {isExpanded && entry.payload && (
                  <pre className="mt-2 text-xs bg-muted p-3 rounded-lg overflow-auto max-h-36 font-mono leading-relaxed">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > AUDIT_PAGE_SIZE && (
        <div className="flex items-center gap-3 justify-center pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function FalkonConnect() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const tabParam = params.get("tab");
  const VALID_TABS = [
    "roadmap","network-identity","peers","requests","audit",
    "overview","verify","properties","units","vendors",
    "capabilities","make-ready","events","usage","eligibility",
  ];
  const initialTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "roadmap";
  const [activeTab, setActiveTab] = useState(initialTab);

  // If the URL tab param changes (e.g. navigated from Today feed), sync it.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p && VALID_TABS.includes(p)) setActiveTab(p);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#B4FF44]/10 border border-[#B4FF44]/30 flex items-center justify-center">
            <span className="text-[#6D9B12] font-black text-lg">F</span>
          </div>
          <h1 className="text-2xl font-bold">Falkon Network Control Center</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1 ml-12">
          Phase gates · Peer management · Cross-business requests · Ed25519 identity · S2S gateway · 12-phase make-ready · 22 capabilities
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 mb-6">
          {/* Network-first tabs */}
          <TabsTrigger value="roadmap">Phase Roadmap</TabsTrigger>
          <TabsTrigger value="network-identity">Network Identity</TabsTrigger>
          <TabsTrigger value="peers">Peer Management</TabsTrigger>
          <TabsTrigger value="requests">Request Inbox</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          {/* Existing gateway tabs */}
          <TabsTrigger value="overview">Gateway</TabsTrigger>
          <TabsTrigger value="verify">5-Step Verify</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
          <TabsTrigger value="make-ready">Make-Ready</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
          <TabsTrigger value="bootstrap">Bootstrap Sync</TabsTrigger>
        </TabsList>

        {/* New network tabs */}
        <TabsContent value="roadmap"><PhaseRoadmapTab /></TabsContent>
        <TabsContent value="network-identity"><NetworkIdentityTab /></TabsContent>
        <TabsContent value="peers"><PeerManagementTab /></TabsContent>
        <TabsContent value="requests"><RequestInboxTab /></TabsContent>
        <TabsContent value="audit"><AuditLogTab /></TabsContent>

        {/* Existing gateway tabs */}
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="verify"><VerifyTab /></TabsContent>
        <TabsContent value="properties">
          <SyncTab
            label="Property"
            endpoint="/falkon/admin/sync/properties"
            description="Push all HALO properties to the Falkon property twin registry."
          />
        </TabsContent>
        <TabsContent value="units">
          <Card>
            <CardHeader>
              <CardTitle>Unit Twin Sync</CardTitle>
              <CardDescription>Push Falkon unit twins for a specific property.</CardDescription>
            </CardHeader>
            <CardContent>
              <UnitSyncTab />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="vendors">
          <SyncTab
            label="Vendor"
            endpoint="/falkon/admin/sync/vendors"
            description="Push all HALO crews to the Falkon vendor twin registry."
          />
        </TabsContent>
        <TabsContent value="capabilities"><CapabilitiesTab /></TabsContent>
        <TabsContent value="make-ready"><MakeReadyTab /></TabsContent>
        <TabsContent value="events"><InboundEventsTab /></TabsContent>
        <TabsContent value="usage"><UsageTab /></TabsContent>
        <TabsContent value="eligibility"><EligibilityTab /></TabsContent>
        <TabsContent value="bootstrap"><BootstrapSyncTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function UnitSyncTab() {
  const [propId, setPropId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    if (!propId) { toast({ title: "Enter a property ID", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const data = await apiFetch<Record<string, unknown>>(`/falkon/admin/sync/units/${propId}`, { method: "POST" });
      setResult(data);
      toast({ title: `Unit sync complete`, description: `${data.synced}/${data.total} synced` });
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-xs">Property ID</Label>
          <Input placeholder="uuid" value={propId} onChange={(e) => setPropId(e.target.value)} className="h-8 text-sm" />
        </div>
        <Button size="sm" onClick={run} disabled={loading}>{loading ? "Syncing…" : "Sync Units"}</Button>
      </div>
      {result && (
        <p className="text-sm">{String(result.synced)} / {String(result.total)} unit twins synced</p>
      )}
    </div>
  );
}

function BootstrapSyncTab({ autoRun = false }: { autoRun?: boolean }) {
  const [report, setReport] = useState<BootstrapReport | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<BootstrapReport>("/falkon/admin/sync/all", { method: "POST" });
      setReport(data);
      toast({
        title: data.ok ? "Bootstrap sync complete" : "Bootstrap sync finished with errors",
        description: `Properties: ${data.steps.properties.synced}/${data.steps.properties.total} · Units seeded: ${data.steps.units.seeded} synced: ${data.steps.units.synced} · Vendors: ${data.steps.vendors.synced}/${data.steps.vendors.total}`,
        variant: data.ok ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Bootstrap sync failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRun) void run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bootstrap Sync</CardTitle>
        <CardDescription>
          One-shot: pushes all properties → unit twins → vendor twins → capabilities to the Falkon
          gateway in sequence. Safe to re-run — all steps are idempotent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={run} disabled={loading}>
          {loading ? "Syncing…" : "Run Bootstrap Sync"}
        </Button>

        {report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={report.ok ? "bg-green-500 text-white" : ""} variant={report.ok ? "default" : "destructive"}>
                {report.ok ? "✓ All steps passed" : "⚠ Completed with errors"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(report.completedAt).toLocaleString()}
              </span>
            </div>

            {/* Properties step */}
            <div className={`p-3 rounded-lg border ${report.steps.properties.errors.length === 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-sm font-medium flex items-center gap-2">
                <span>{report.steps.properties.errors.length === 0 ? "✓" : "✗"}</span>
                Properties
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {report.steps.properties.synced}/{report.steps.properties.total} synced
                </span>
              </p>
              {report.steps.properties.errors.length > 0 && (
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {report.steps.properties.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </div>

            {/* Units step */}
            <div className={`p-3 rounded-lg border ${report.steps.units.errors.length === 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-sm font-medium flex items-center gap-2">
                <span>{report.steps.units.errors.length === 0 ? "✓" : "✗"}</span>
                Units
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  seeded {report.steps.units.seeded} · synced {report.steps.units.synced}
                </span>
              </p>
              {report.steps.units.errors.length > 0 && (
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {report.steps.units.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </div>

            {/* Vendors step */}
            <div className={`p-3 rounded-lg border ${report.steps.vendors.errors.length === 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-sm font-medium flex items-center gap-2">
                <span>{report.steps.vendors.errors.length === 0 ? "✓" : "✗"}</span>
                Vendors
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {report.steps.vendors.synced}/{report.steps.vendors.total} synced
                </span>
              </p>
              {report.steps.vendors.errors.length > 0 && (
                <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                  {report.steps.vendors.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
            </div>

            {/* Capabilities step */}
            <div className={`p-3 rounded-lg border ${report.steps.capabilities.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <p className="text-sm font-medium flex items-center gap-2">
                <span>{report.steps.capabilities.ok ? "✓" : "✗"}</span>
                Capabilities
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {report.steps.capabilities.registered} registered
                </span>
              </p>
              {report.steps.capabilities.error && (
                <p className="mt-1 text-xs text-red-700">• {report.steps.capabilities.error}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
