import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { getListCrewsQueryKey, useListCrews, type CrewMapPin } from "@workspace/api-client-react";
import "./haloCrewPaycard.css";

type Paycard = {
  crewId: string;
  name: string;
  trade: string | null;
  selfiePath: string | null;
  url: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function PaycardQr({ url }: { url: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 160,
      color: { dark: "#0F1B2D", light: "#ffffff" },
    }).then((out) => {
      if (alive) setSvg(out);
    }).catch(() => {
      if (alive) setSvg("");
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (!svg) return <div className="halo-paycard-qr" aria-hidden />;
  return (
    <div
      className="halo-paycard-qr"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function printCard(card: Paycard, qrSvg: string) {
  const w = window.open("", "_blank", "noopener,width=420,height=680");
  if (!w) return;
  const trade = card.trade ? `<p style="margin:4px 0 0;color:#B4FF44;font-weight:700">${card.trade}</p>` : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${card.name} — HALO paycard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: 3.75in 5.5in; margin: 0.3in; }
  html, body { margin: 0; background: #0F1B2D; color: #F4F4F0; font-family: Outfit, "Plus Jakarta Sans", sans-serif; }
  .sheet { padding: 28px 22px; text-align: center; }
  .kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.28em; text-transform: uppercase; color: #B4FF44; }
  h1 { margin: 10px 0 4px; font-size: 28px; letter-spacing: -0.04em; }
  .qr { width: 200px; height: 200px; margin: 18px auto; background: #fff; border-radius: 18px; padding: 12px; }
  .qr svg { width: 176px; height: 176px; }
  .rule { margin-top: 18px; font-size: 14px; line-height: 1.45; color: rgba(244,244,240,0.78); }
</style></head><body>
  <div class="sheet">
    <div class="kicker">HALO paycard</div>
    <h1>${card.name}</h1>
    ${trade}
    <div class="qr">${qrSvg}</div>
    <p class="rule"><strong>Scan to get paid.</strong><br>Check in by unit · before photo · after photo · check out.</p>
  </div>
</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function OnePaycard({ card, live }: { card: Paycard; live: boolean }) {
  const [qrSvg, setQrSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(card.url, {
      type: "svg",
      margin: 1,
      width: 220,
      color: { dark: "#0F1B2D", light: "#ffffff" },
    }).then((out) => {
      if (alive) setQrSvg(out);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [card.url]);

  return (
    <article className="halo-paycard" data-live={live ? "true" : "false"}>
      <PaycardQr url={card.url} />
      <div className="halo-paycard-meta">
        <div className="halo-paycard-who">
          {card.selfiePath ? (
            <img className="halo-paycard-face" src={`/api/storage${card.selfiePath}`} alt="" />
          ) : (
            <span className="halo-paycard-face">{initials(card.name)}</span>
          )}
          <div>
            <strong>{card.name}</strong>
            <em>{live ? "On site now" : card.trade || "Scan to get paid"}</em>
          </div>
        </div>
        <p className="halo-paycard-hint">Check in · photos · check out</p>
        <div className="halo-paycard-actions">
          <button type="button" onClick={() => printCard(card, qrSvg)}>
            Print
          </button>
          <button
            type="button"
            data-ghost="true"
            onClick={() => navigator.clipboard?.writeText(card.url)}
          >
            Copy link
          </button>
        </div>
      </div>
    </article>
  );
}

export function HaloCrewPaycards(props: { pins?: CrewMapPin[] }) {
  const { data: crews } = useListCrews({ query: { queryKey: getListCrewsQueryKey() } });
  const [cards, setCards] = useState<Paycard[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/crew-checkin-links/paycards", { method: "POST", credentials: "include" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { cards?: Paycard[]; error?: string };
        if (!r.ok) throw new Error(j.error || "Could not mint paycards");
        if (alive) setCards(j.cards ?? []);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load paycards");
      });
    return () => {
      alive = false;
    };
  }, []);

  const liveIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of props.pins ?? []) {
      if (p.lastCheckinKind === "checkin" && p.lat != null && p.lng != null) ids.add(p.id);
    }
    return ids;
  }, [props.pins]);

  const roster = cards ?? (crews ?? []).filter((c) => c.active !== false).map((c) => ({
    crewId: c.id,
    name: c.name,
    trade: c.trade ?? null,
    selfiePath: c.selfiePath ?? null,
    url: "",
  }));

  return (
    <div className="halo-paycards">
      <p className="halo-paycards-lead">
        Each person gets a QR paycard. They scan it, log the unit, take before and after photos, and check out — that is how they get paid. Check-in drops their green pin on the map.
      </p>
      {error ? <p className="halo-desk-empty">{error}</p> : null}
      {!cards && !error ? <p className="halo-desk-empty">Minting live paycards…</p> : null}
      {roster.map((card) =>
        card.url ? (
          <OnePaycard key={card.crewId} card={card} live={liveIds.has(card.crewId)} />
        ) : (
          <article key={card.crewId} className="halo-paycard">
            <div className="halo-paycard-qr" />
            <div className="halo-paycard-meta">
              <strong>{card.name}</strong>
              <em>{card.trade || "Paycard"}</em>
            </div>
          </article>
        ),
      )}
    </div>
  );
}
