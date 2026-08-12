import { useState, useEffect } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

// ─── types ───────────────────────────────────────────────────────────────────

type Mode = "OFF" | "SHADOW" | "ASSISTED" | "LIVE";

interface FalkonConnection {
  id: string;
  falkonOrgId?: string;
  webhookUrl?: string;
  mode: Mode;
  capabilities: string[];
  connectedAt?: string;
  verifiedAt?: string;
  lastPingAt?: string;
}

interface FalkonEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId?: string;
  status: string;
  attempts: number;
  error?: string;
  createdAt: string;
  deliveredAt?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<Mode, string> = {
  OFF: "Off — no events emitted",
  SHADOW: "Shadow — read-only event copies sent to Falkon",
  ASSISTED: "Assisted — Falkon proposals appear in the autopilot inbox",
  LIVE: "Live — auto-dispatch and AI photo QC within policy thresholds",
};

const MODE_BADGE: Record<Mode, "secondary" | "default" | "outline"> = {
  OFF: "secondary",
  SHADOW: "outline",
  ASSISTED: "default",
  LIVE: "default",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ─── component ───────────────────────────────────────────────────────────────

export default function FalkonConnect() {
  const { toast } = useToast();
  const [connection, setConnection] = useState<FalkonConnection | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<FalkonEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Connect form state
  const [partnerKey, setPartnerKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [mode, setMode] = useState<Mode>("SHADOW");

  // ─── fetch ─────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    try {
      const [connRes, evtRes] = await Promise.all([
        fetch("/api/falkon/connection", { credentials: "include" }),
        fetch("/api/falkon/events?status=failed&limit=20", { credentials: "include" }),
      ]);
      const connData = await connRes.json();
      const evtData = await evtRes.json();
      setConnected(connData.connected ?? false);
      setConnection(connData.connection ?? null);
      if (connData.connection?.mode) setMode(connData.connection.mode as Mode);
      setEvents(evtData.events ?? []);
    } catch {
      toast({ variant: "destructive", description: "Failed to load Falkon status." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // ─── actions ───────────────────────────────────────────────────────────

  async function handleConnect() {
    if (!partnerKey || !webhookUrl || !webhookSecret) {
      toast({ variant: "destructive", description: "All three fields are required." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/falkon/connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerKey, webhookUrl, webhookSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Connect failed");
      setConnection(data.connection);
      setConnected(true);
      setPartnerKey("");
      setWebhookSecret("");
      toast({ description: "Falkon integration connected. Run Verify to confirm the webhook." });
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await fetch("/api/falkon/verify", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verify failed");
      setConnection(data.connection);
      toast({ description: "Webhook verified — integration is ready to use." });
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message });
    } finally {
      setVerifying(false);
    }
  }

  async function handleModeChange(newMode: Mode) {
    setSaving(true);
    try {
      const res = await fetch("/api/falkon/connection", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Mode update failed");
      setConnection(data.connection);
      setMode(newMode);
      toast({ description: `Mode updated to ${newMode}.` });
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      const res = await fetch("/api/falkon/connection", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Disconnect failed");
      setConnected(false);
      setConnection(null);
      setMode("SHADOW");
      toast({ description: "Falkon integration disconnected." });
    } catch (e: any) {
      toast({ variant: "destructive", description: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleRetry(eventId: string) {
    try {
      await fetch(`/api/falkon/events/${eventId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      toast({ description: "Event queued for redelivery." });
      void load();
    } catch {
      toast({ variant: "destructive", description: "Retry failed." });
    }
  }

  // ─── render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading Falkon status…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <img
          src="/falkon-logo.png"
          alt="Falkon"
          className="h-7 opacity-80"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Falkon Ops Integration</h1>
          <p className="text-sm text-muted-foreground">
            Falkon is the invisible operating runtime beneath HALO — operators never see it.
          </p>
        </div>
      </div>

      {/* Connection status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Connection</CardTitle>
            <Badge variant={connected ? (connection?.verifiedAt ? "default" : "outline") : "secondary"}>
              {connected ? (connection?.verifiedAt ? "Verified" : "Connected (unverified)") : "Not connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected && connection ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Webhook URL</dt>
                <dd className="truncate font-mono text-xs">{connection.webhookUrl ?? "—"}</dd>
                <dt className="text-muted-foreground">Falkon Org ID</dt>
                <dd className="font-mono text-xs">{connection.falkonOrgId ?? "—"}</dd>
                <dt className="text-muted-foreground">Connected</dt>
                <dd>{fmt(connection.connectedAt)}</dd>
                <dt className="text-muted-foreground">Verified</dt>
                <dd>{fmt(connection.verifiedAt)}</dd>
                <dt className="text-muted-foreground">Last ping</dt>
                <dd>{fmt(connection.lastPingAt)}</dd>
              </dl>

              <div className="flex gap-2 pt-1">
                {!connection.verifiedAt && (
                  <Button size="sm" onClick={handleVerify} disabled={verifying}>
                    {verifying ? "Verifying…" : "Verify webhook"}
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" disabled={saving}>
                      Disconnect
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect Falkon?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Mode will be set to OFF and all credentials cleared. Pending outbox events
                        will not be delivered. HALO operations are unaffected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDisconnect}>Disconnect</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>Falkon partner key</Label>
                <Input
                  type="password"
                  placeholder="sk_live_…"
                  value={partnerKey}
                  onChange={(e) => setPartnerKey(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Webhook URL</Label>
                <Input
                  type="url"
                  placeholder="https://api.falkonops.com/halo/webhooks/…"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Webhook signing secret</Label>
                <Input
                  type="password"
                  placeholder="whsec_…"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Obtained from the Falkon developer portal. HALO signs every outbound callback
                  with this secret — Falkon verifies on receipt.
                </p>
              </div>
              <Button onClick={handleConnect} disabled={saving}>
                {saving ? "Connecting…" : "Connect to Falkon"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mode ladder */}
      {connected && connection?.verifiedAt && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Integration mode</CardTitle>
            <CardDescription>
              Controls how deeply Falkon participates in HALO workflows. Start with Shadow and
              promote only after reviewing twin accuracy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={mode}
              onValueChange={(v) => handleModeChange(v as Mode)}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["OFF", "SHADOW", "ASSISTED", "LIVE"] as Mode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="font-medium mr-2">{m}</span>
                    <span className="text-muted-foreground text-xs">{MODE_LABELS[m]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Mode guide */}
            <div className="rounded-md border bg-muted/40 p-3 space-y-1 text-xs text-muted-foreground">
              <p><strong className="text-foreground">OFF</strong> — HALO is standalone. No events emitted.</p>
              <p><strong className="text-foreground">Shadow</strong> — Falkon receives signed copies of HALO events (walk approvals, job updates, GPS check-ins). HALO ignores responses. Recommended for the first two weeks.</p>
              <p><strong className="text-foreground">Assisted</strong> — Falkon proposals (crew ranking, schedule suggestions) surface in the JARVIS autopilot inbox. Office approves before execution.</p>
              <p><strong className="text-foreground">Live</strong> — Falkon can auto-dispatch to the ranked crew and run AI photo QC, within the policy thresholds configured below. Thresholds exceeded → office approval still required.</p>
            </div>

            {mode === "LIVE" && (
              <p className="text-xs text-amber-500">
                Live mode is active. Verify policy thresholds are configured correctly before enabling auto-dispatch on any property.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Failed events */}
      {connected && events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Failed deliveries</CardTitle>
            <CardDescription>
              Events that failed to deliver to Falkon's webhook after 5 attempts. Retry or
              investigate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.eventType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.entityType}{e.entityId ? ` ${e.entityId.slice(0, 8)}…` : ""}
                    </TableCell>
                    <TableCell>{e.attempts}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(e.createdAt)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => handleRetry(e.id)}>
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Phase guide */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Phase 0 — Shadow rollout guide</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Connect with your Falkon partner key and webhook URL above.</li>
            <li>Click Verify — HALO sends a signed test ping to confirm the webhook responds.</li>
            <li>Leave mode on Shadow for 2 weeks. Falkon will index your properties, jobs, and evidence bundles.</li>
            <li>Review twin accuracy in the Falkon dashboard, then promote to Assisted.</li>
            <li>In Assisted mode, Falkon crew-ranking suggestions appear in the JARVIS autopilot inbox.</li>
            <li>After validating Assisted on 1–2 properties, promote those properties to Live mode in Falkon Policies.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
