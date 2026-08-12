import { useState, useEffect, useCallback } from "react";
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
      // GET /falkon/connection returns { connected: bool, connection?: {...} }
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
      // POST /falkon/connect requires: partnerKey, webhookUrl, webhookSecret
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
      // DELETE /falkon/connection is the correct disconnect endpoint
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

// ─── Capabilities Tab ─────────────────────────────────────────────────────────

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

const PHASES = [
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

  const phaseIdx = (phase: string) => PHASES.indexOf(phase);

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
              {/* Phase progress bar */}
              <div className="flex gap-1 flex-wrap">
                {PHASES.map((ph, i) => {
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

              {/* Gate results */}
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

              {/* Event log */}
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
      // Uses the dedicated office-gated inbound-events endpoint, not the
      // outbound event outbox (/falkon/events).
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
      void load();
    } catch (err: any) {
      toast({ title: "Promotion failed", description: err.message, variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
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
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function FalkonConnect() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Falkon Ops — Enterprise Integration</h1>
        <p className="text-muted-foreground text-sm mt-1">
          S2S gateway · Ed25519 signing · 12-phase make-ready · 22 capabilities
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="verify">5-Step Verify</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
          <TabsTrigger value="make-ready">Make-Ready</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
        </TabsList>

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
