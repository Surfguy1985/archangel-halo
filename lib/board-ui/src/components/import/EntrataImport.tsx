import { useRef, useState, type CSSProperties } from "react";
import type { EntrataImportDocument, EntrataImportKind } from "@workspace/api-client-react";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const KINDS: Array<{ id: EntrataImportKind; label: string }> = [
  { id: "units", label: "Units" },
  { id: "leases", label: "Leases" },
  { id: "notices", label: "Notices to vacate" },
  { id: "purchase_orders", label: "Purchase orders" },
];

export type EntrataImportProps = {
  adapter?: string;
  imports?: EntrataImportDocument[];
  loading?: boolean;
  onImport: (kind: EntrataImportKind, filename: string, csv: string) => void | Promise<void>;
  onTemplate: (kind: EntrataImportKind) => void | Promise<void>;
  homeHref?: { label: string; onClick: () => void };
};

export function EntrataImport(props: EntrataImportProps) {
  const [kind, setKind] = useState<EntrataImportKind>("units");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => void | Promise<void>) => {
    setError(null);
    setBusy(true);
    void Promise.resolve(fn())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message.replace(/^HTTP \d+ [^:]+:\s*/, "") : "That did not go through.";
        setError(message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: INK,
        color: "#F4F7F2",
        fontFamily: BODY,
      }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
      />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 20px 64px" }}>
        {props.homeHref ? (
          <button type="button" onClick={props.homeHref.onClick} style={ghostBtn}>
            {props.homeHref.label}
          </button>
        ) : null}
        <p style={{ margin: "16px 0 0", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: MUTED, fontFamily: DISPLAY, fontWeight: 600 }}>
          Entrata
        </p>
        <h1 style={{ margin: "4px 0 8px", fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          CSV import
        </h1>
        <p style={{ margin: "0 0 20px", color: MUTED, fontSize: 13, maxWidth: 560 }}>
          No API access in v1. Upload the unit, lease, notice-to-vacate, or PO export. The same file is skipped on a second pass.
          Adapter: <span style={{ fontFamily: MONO }}>{props.adapter ?? "csv"}</span>
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              style={{
                ...ghostBtn,
                borderColor: kind === k.id ? LIME : HAIRLINE,
                color: kind === k.id ? INK : "#F4F7F2",
                background: kind === k.id ? LIME : "transparent",
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Entrata CSV file"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            run(async () => {
              const csv = await file.text();
              await props.onImport(kind, file.name, csv);
            });
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} style={{ ...ghostBtn, background: LIME, color: INK, borderColor: LIME }}>
            {busy ? "Importing…" : "Upload CSV"}
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => props.onTemplate(kind))} style={ghostBtn}>
            Download template
          </button>
        </div>
        {error ? (
          <p role="alert" style={{ color: CORAL, marginTop: 12, fontSize: 13 }}>
            {error}
          </p>
        ) : null}

        <h2 style={{ fontFamily: DISPLAY, fontSize: 16, margin: "32px 0 12px" }}>Recent batches</h2>
        {props.loading && !props.imports?.length ? (
          <p style={{ color: MUTED }}>Loading…</p>
        ) : (props.imports ?? []).length === 0 ? (
          <p style={{ color: MUTED }}>No imports yet.</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {props.imports!.map((batch) => (
              <li key={batch.id} style={{ padding: "12px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{batch.filename}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: batch.status === "failed" ? CORAL : GOLD }}>
                    {batch.status}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0", fontFamily: MONO, fontSize: 12, color: MUTED }}>
                  {batch.kind} · created {batch.createdCount} · updated {batch.updatedCount} · skipped {batch.skippedCount}
                  {batch.errorCount ? ` · ${batch.errorCount} errors` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const ghostBtn: CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 999,
  border: `1px solid ${HAIRLINE}`,
  background: "transparent",
  color: "#F4F7F2",
  fontFamily: BODY,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
