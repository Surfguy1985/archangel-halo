import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type {
  EvidencePhotoDocument,
  EvidenceTrailDocument,
  TurnEvidenceDocument,
  TurnVerifyDocument,
} from "@workspace/api-client-react";

const INK = "#07101E";
const LIME = "#B4FF44";
const GOLD = "#E8C36A";
const CORAL = "#F07167";
const HAIRLINE = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.58)";
const DISPLAY = '"Outfit", "Plus Jakarta Sans", sans-serif';
const BODY = '"Plus Jakarta Sans", "Outfit", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export type EvidenceRecordVariant = "full" | "move_out_condition";

export type EvidenceLedgerProps = {
  evidence: TurnEvidenceDocument | undefined;
  verify: TurnVerifyDocument | undefined;
  loading?: boolean;
  onDownloadRecord: (variant: EvidenceRecordVariant) => void | Promise<void>;
  onVerify?: () => void | Promise<void>;
};

type FlatPhoto = EvidencePhotoDocument & { roomLabel: string };

export function EvidenceLedger(props: EvidenceLedgerProps) {
  const rooms = props.evidence?.rooms ?? [];
  const photos = useMemo<FlatPhoto[]>(() => {
    const out: FlatPhoto[] = [];
    for (const room of rooms) {
      for (const phase of ["before", "after", "during", "qc"] as const) {
        for (const photo of room[phase]) {
          out.push({ ...photo, roomLabel: room.label });
        }
      }
    }
    return out;
  }, [rooms]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<EvidenceRecordVariant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openIndex = openId ? photos.findIndex((p) => p.id === openId) : -1;

  if (props.loading && !props.evidence) {
    return <p style={{ color: MUTED, fontSize: 13 }}>Loading evidence…</p>;
  }

  return (
    <div data-testid="evidence-ledger">
      <VerifyStrip verify={props.verify} hash={props.evidence?.verificationHash ?? null} onVerify={props.onVerify} />

      {rooms.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 13 }}>No photos on this turn yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {rooms.map((room) => (
            <RoomBlock
              key={room.room}
              label={room.label}
              before={room.before[0]}
              after={room.after[0]}
              extras={[...room.during, ...room.qc]}
              onOpen={(id) => setOpenId(id)}
            />
          ))}
        </div>
      )}

      {props.evidence?.trail ? <GpsTrail trail={props.evidence.trail} /> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24 }}>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            setError(null);
            setBusy("full");
            void Promise.resolve(props.onDownloadRecord("full"))
              .catch((err: unknown) => {
                setError(err instanceof Error && err.message ? err.message : "Download failed.");
              })
              .finally(() => setBusy(null));
          }}
          style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}
        >
          {busy === "full" ? "Rendering…" : "Download unit turn record"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            setError(null);
            setBusy("move_out_condition");
            void Promise.resolve(props.onDownloadRecord("move_out_condition"))
              .catch((err: unknown) => {
                setError(err instanceof Error && err.message ? err.message : "Download failed.");
              })
              .finally(() => setBusy(null));
          }}
          style={{ ...ghostBtn, opacity: busy ? 0.7 : 1 }}
        >
          {busy === "move_out_condition" ? "Rendering…" : "Download move-out condition report"}
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: CORAL, fontSize: 13, marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      {openIndex >= 0 ? (
        <FullscreenViewer
          photos={photos}
          index={openIndex}
          onIndex={(i) => setOpenId(photos[i]?.id ?? null)}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function VerifyStrip(props: {
  verify: TurnVerifyDocument | undefined;
  hash: string | null;
  onVerify?: () => void | Promise<void>;
}) {
  const hash = props.verify?.storedHash ?? props.hash;
  if (!hash && !props.verify) return null;
  const matches = props.verify?.matches;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        marginBottom: 20,
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px solid ${matches === false ? "rgba(240,113,103,0.45)" : HAIRLINE}`,
        background: matches === false ? "rgba(240,113,103,0.08)" : "rgba(255,255,255,0.03)",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: matches === false ? CORAL : matches ? LIME : MUTED,
          fontVariantNumeric: "tabular-nums",
          wordBreak: "break-all",
        }}
      >
        {matches === false ? "Ledger does not match" : matches ? "Ledger verified" : "Verification"}
        {hash ? ` · ${hash.slice(0, 12)}…` : ""}
      </span>
      {props.onVerify ? (
        <button type="button" onClick={() => void props.onVerify?.()} style={{ ...chipBtn, minHeight: 36, padding: "0 12px" }}>
          Re-verify
        </button>
      ) : null}
    </div>
  );
}

function RoomBlock(props: {
  label: string;
  before?: EvidencePhotoDocument;
  after?: EvidencePhotoDocument;
  extras: EvidencePhotoDocument[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h4
        style={{
          margin: "0 0 10px",
          fontFamily: DISPLAY,
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        {props.label}
      </h4>
      {props.before && props.after ? (
        <CompareSlider before={props.before} after={props.after} onOpen={props.onOpen} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {props.before ? <Still photo={props.before} tag="Before" onOpen={props.onOpen} /> : null}
          {props.after ? <Still photo={props.after} tag="After" onOpen={props.onOpen} /> : null}
        </div>
      )}
      {props.before || props.after ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          {props.before ? <Caption photo={props.before} /> : <span />}
          {props.after ? <Caption photo={props.after} /> : <span />}
        </div>
      ) : null}
      {props.extras.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
          {props.extras.map((photo) => (
            <Still
              key={photo.id}
              photo={photo}
              tag={photo.phase === "qc" ? "QC" : "During"}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CompareSlider(props: {
  before: EvidencePhotoDocument;
  after: EvidencePhotoDocument;
  onOpen: (id: string) => void;
}) {
  const [pct, setPct] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const move = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPct(Math.min(96, Math.max(4, ((clientX - box.left) / box.width) * 100)));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    move(e.clientX);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Before and after"
      aria-valuemin={4}
      aria-valuemax={96}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        move(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPct((p) => Math.max(4, p - 4));
        if (e.key === "ArrowRight") setPct((p) => Math.min(96, p + 4));
        if (e.key === "Enter") props.onOpen(props.after.id);
      }}
      style={{
        position: "relative",
        height: 220,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${HAIRLINE}`,
        cursor: "ew-resize",
        touchAction: "none",
        background: "#050A12",
      }}
    >
      <img src={props.after.viewUrl} alt="After" style={fillImg} draggable={false} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          overflow: "hidden",
        }}
      >
        <img
          src={props.before.viewUrl}
          alt="Before"
          draggable={false}
          style={{ ...fillImg, width: `${100 / (pct / 100)}%`, maxWidth: "none" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pct}%`,
          width: 2,
          marginLeft: -1,
          background: LIME,
          boxShadow: "0 0 0 1px rgba(7,16,30,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${pct}%`,
          width: 28,
          height: 28,
          marginLeft: -14,
          marginTop: -14,
          borderRadius: "50%",
          background: LIME,
          color: INK,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          pointerEvents: "none",
        }}
      >
        ⟷
      </div>
      <span style={phaseTag("left")}>Before</span>
      <span style={phaseTag("right")}>After</span>
      <IntegrityChips flags={props.before.integrityFlags} corner="left" />
      <IntegrityChips flags={props.after.integrityFlags} corner="right" />
      <button
        type="button"
        aria-label="Open full screen"
        onClick={(e) => {
          e.stopPropagation();
          props.onOpen(props.after.id);
        }}
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          minHeight: 36,
          padding: "0 10px",
          borderRadius: 999,
          border: `1px solid ${HAIRLINE}`,
          background: "rgba(7,16,30,0.72)",
          color: "#F4F7F2",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Full screen
      </button>
    </div>
  );
}

function Still(props: { photo: EvidencePhotoDocument; tag: string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.photo.id)}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: 120,
        padding: 0,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 12,
        overflow: "hidden",
        background: "#050A12",
        cursor: "pointer",
      }}
    >
      <img src={props.photo.thumbUrl} alt={props.tag} style={fillImg} />
      <span style={phaseTag("left")}>{props.tag}</span>
      <IntegrityChips flags={props.photo.integrityFlags} corner="right" />
    </button>
  );
}

function Caption(props: { photo: EvidencePhotoDocument }) {
  const dist =
    props.photo.distanceM != null ? `${Math.round(props.photo.distanceM)}m from unit` : "GPS unknown";
  return (
    <p style={{ margin: 0, fontSize: 11, color: MUTED, lineHeight: 1.45 }}>
      {props.photo.capturedAtLabel}
      {" · "}
      {props.photo.device}
      {" · "}
      {dist}
      {" · "}
      {props.photo.capturedByName}
    </p>
  );
}

function IntegrityChips(props: {
  flags: EvidencePhotoDocument["integrityFlags"];
  corner: "left" | "right";
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!props.flags.length) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        [props.corner]: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: props.corner === "right" ? "flex-end" : "flex-start",
        gap: 4,
        maxWidth: "70%",
        zIndex: 2,
      }}
    >
      {props.flags.map((flag) => {
        const shown = open === flag.code;
        return (
          <button
            key={flag.code}
            type="button"
            aria-expanded={shown}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(shown ? null : flag.code);
            }}
            style={{
              border: `1px solid ${GOLD}`,
              background: shown ? GOLD : "rgba(7,16,30,0.82)",
              color: shown ? INK : GOLD,
              borderRadius: 999,
              minHeight: 28,
              padding: shown ? "4px 10px" : "0 8px",
              fontSize: 10,
              fontWeight: 600,
              textAlign: "left",
              cursor: "pointer",
              fontFamily: BODY,
            }}
          >
            {shown ? flag.explanation : "!"}
          </button>
        );
      })}
    </div>
  );
}

function GpsTrail(props: { trail: EvidenceTrailDocument }) {
  const { points, geofence, checkIn, checkOut } = props.trail;
  if (!points.length && geofence.radiusM <= 0) return null;

  const all = [
    ...points,
    ...(geofence.radiusM > 0 ? [{ lat: geofence.lat, lng: geofence.lng }] : []),
  ];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max((maxLat - minLat) * 0.18, 0.0004);
  const padLng = Math.max((maxLng - minLng) * 0.18, 0.0004);
  const W = 420;
  const H = 180;
  const xOf = (lng: number) => ((lng - (minLng - padLng)) / (maxLng - minLng + padLng * 2)) * W;
  const yOf = (lat: number) => (1 - (lat - (minLat - padLat)) / (maxLat - minLat + padLat * 2)) * H;
  const midLat = (minLat + maxLat) / 2;
  const metersPerDeg = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const rPx =
    geofence.radiusM > 0
      ? (geofence.radiusM / Math.max(metersPerDeg * (maxLng - minLng + padLng * 2), 1)) * W
      : 0;
  const d = points.map((p) => `${xOf(p.lng).toFixed(1)},${yOf(p.lat).toFixed(1)}`).join(" ");

  return (
    <section style={{ marginTop: 28 }}>
      <h4 style={{ margin: "0 0 10px", fontFamily: DISPLAY, fontSize: 15, fontWeight: 600 }}>
        GPS trail
      </h4>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Check-in, trail, and check-out"
        style={{
          width: "100%",
          height: 160,
          borderRadius: 12,
          border: `1px solid ${HAIRLINE}`,
          background: "#050A12",
        }}
      >
        {rPx > 0 ? (
          <circle
            cx={xOf(geofence.lng)}
            cy={yOf(geofence.lat)}
            r={rPx}
            fill="rgba(232,195,106,0.12)"
            stroke={GOLD}
            strokeWidth={1.2}
            strokeDasharray="4 3"
          />
        ) : null}
        {points.length > 1 ? (
          <polyline points={d} fill="none" stroke="rgba(180,255,68,0.75)" strokeWidth={2} />
        ) : null}
        {checkIn ? (
          <circle cx={xOf(checkIn.lng)} cy={yOf(checkIn.lat)} r={5} fill={LIME} />
        ) : null}
        {checkOut ? (
          <circle cx={xOf(checkOut.lng)} cy={yOf(checkOut.lat)} r={5} fill={GOLD} />
        ) : null}
      </svg>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: MUTED }}>
        Lime is check-in · gold is check-out
        {geofence.radiusM > 0 ? ` · ${geofence.radiusM}m geofence` : ""}
      </p>
    </section>
  );
}

function FullscreenViewer(props: {
  photos: FlatPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const photo = props.photos[props.index];
  const [scale, setScale] = useState(1);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    setScale(1);
  }, [props.index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        props.onClose();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        props.onIndex(Math.max(0, props.index - 1));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        props.onIndex(Math.min(props.photos.length - 1, props.index + 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props]);

  if (!photo) return null;

  const distOf = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${photo.roomLabel} ${photo.phase}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(5,10,18,0.96)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <button type="button" onClick={props.onClose} style={ghostBtn}>
          Close
        </button>
        <span style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
          {photo.roomLabel} · {photo.phase}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 12, color: MUTED }}>
          {props.index + 1} / {props.photos.length}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "none",
        }}
        onWheel={(e) => {
          e.preventDefault();
          setScale((s) => Math.min(4, Math.max(1, s * (e.deltaY < 0 ? 1.12 : 0.9))));
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            pinch.current = { dist: distOf(e.touches[0]!, e.touches[1]!), scale };
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current) {
            const next = distOf(e.touches[0]!, e.touches[1]!) / pinch.current.dist;
            setScale(Math.min(4, Math.max(1, pinch.current.scale * next)));
          }
        }}
        onTouchEnd={() => {
          pinch.current = null;
        }}
      >
        <img
          src={photo.viewUrl}
          alt={`${photo.roomLabel} ${photo.phase}`}
          draggable={false}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            transition: scale === 1 ? "transform 120ms ease" : undefined,
          }}
        />
      </div>
      <div style={{ padding: "12px 16px 20px" }}>
        <Caption photo={photo} />
        {photo.integrityFlags.length ? (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {photo.integrityFlags.map((flag) => (
              <li key={flag.code} style={{ color: GOLD, fontSize: 12, marginTop: 4 }}>
                {flag.explanation}
              </li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            disabled={props.index === 0}
            onClick={() => props.onIndex(props.index - 1)}
            style={ghostBtn}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={props.index >= props.photos.length - 1}
            onClick={() => props.onIndex(props.index + 1)}
            style={ghostBtn}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function phaseTag(side: "left" | "right"): CSSProperties {
  return {
    position: "absolute",
    [side]: 8,
    bottom: 8,
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(7,16,30,0.72)",
    color: "#F4F7F2",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    pointerEvents: "none",
  };
}

const fillImg: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  pointerEvents: "none",
};

const chipBtn: CSSProperties = {
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

const ghostBtn: CSSProperties = { ...chipBtn };

const primaryBtn: CSSProperties = {
  ...chipBtn,
  background: LIME,
  color: INK,
  borderColor: LIME,
  width: "100%",
};
