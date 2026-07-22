import { useParams } from "wouter";
import {
  useGetPhotoShare,
  getGetPhotoShareQueryKey,
  type PhotoShareView,
} from "@workspace/api-client-react";
import {
  Camera,
  Loader2,
  ShieldCheck,
  LogIn,
  LogOut,
  ClipboardList,
  FileDown,
} from "lucide-react";

type SharePhoto = PhotoShareView["photos"][number];
type ShareCheckin = PhotoShareView["checkins"][number];

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function PhotoGrid({
  photos,
  base,
}: {
  photos: SharePhoto[];
  base: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
      {photos.map((p) => (
        <a
          key={p.id}
          href={`${base}/api/storage${p.storagePath}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-[12px] overflow-hidden bg-card border border-border shadow-[var(--shadow)]"
        >
          <div className="aspect-square">
            <img
              src={`${base}/api/storage${p.storagePath}`}
              alt={p.note || "Crew photo"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          {p.note && (
            <div className="px-[8px] py-[6px] text-[11.5px] text-muted-foreground leading-snug">
              {p.note}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}

function PhaseBlock({
  title,
  photos,
  base,
  tone,
}: {
  title: string;
  photos: SharePhoto[];
  base: string;
  tone: "before" | "after" | "other";
}) {
  if (photos.length === 0) return null;
  const badgeCls =
    tone === "before"
      ? "bg-[rgba(23,24,28,0.07)] text-[var(--ink)]"
      : tone === "after"
        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
        : "bg-[rgba(143,106,31,0.1)] text-[var(--gold-dark)]";
  return (
    <div className="mt-[10px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <span
          className={`text-[10.5px] font-display font-bold uppercase tracking-[0.12em] rounded-full px-[9px] py-[3px] ${badgeCls}`}
        >
          {title}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </span>
      </div>
      <PhotoGrid photos={photos} base={base} />
    </div>
  );
}

function CheckinRow({ c, crewName }: { c: ShareCheckin; crewName: string }) {
  const isIn = c.kind === "checkin";
  return (
    <div className="flex items-start gap-[9px] py-[7px]">
      <div
        className={`mt-[2px] w-[24px] h-[24px] rounded-full grid place-items-center shrink-0 ${
          isIn ? "bg-emerald-50 text-emerald-700" : "bg-[rgba(23,24,28,0.07)] text-[var(--ink)]"
        }`}
      >
        {isIn ? <LogIn className="w-[12px] h-[12px]" /> : <LogOut className="w-[12px] h-[12px]" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">
          <b>{crewName}</b> {isIn ? "checked in" : "checked out"} ·{" "}
          <span className="text-muted-foreground">{formatTime(c.createdAt)}</span>
        </div>
        {c.label && <div className="text-[12px] text-muted-foreground">{c.label}</div>}
        {c.note && (
          <div className="mt-[4px] text-[12.5px] bg-[rgba(23,24,28,0.04)] rounded-[9px] px-[10px] py-[7px] leading-snug">
            <span className="font-semibold">Work done:</span> {c.note}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PhotoShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPhotoShare(token, {
    query: { queryKey: getGetPhotoShareQueryKey(token) },
  });

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-display font-bold text-[18px]">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This photo link isn't valid or has been removed.
          </p>
        </div>
      </div>
    );
  }

  const jobKeys: string[] = [];
  const seen = new Set<string>();
  const keyOf = (jobId: string | null | undefined) => jobId ?? "none";
  for (const p of data.photos) {
    const k = keyOf(p.jobId);
    if (!seen.has(k)) {
      seen.add(k);
      jobKeys.push(k);
    }
  }
  for (const c of data.checkins) {
    const k = keyOf(c.jobId);
    if (!seen.has(k)) {
      seen.add(k);
      jobKeys.push(k);
    }
  }
  jobKeys.sort((a, b) => (a === "none" ? 1 : b === "none" ? -1 : 0));

  const labelFor = (k: string) => {
    if (k === "none") return "General activity";
    const p = data.photos.find((x) => keyOf(x.jobId) === k && x.jobLabel);
    if (p?.jobLabel) return p.jobLabel;
    const c = data.checkins.find((x) => keyOf(x.jobId) === k && x.jobLabel);
    return c?.jobLabel ?? "Job";
  };

  return (
    <div className="min-h-screen bg-[var(--bg,#f4f2ee)]">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[20px] pb-[16px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-light)]">
          ArchAngel · HALO
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[3px]">
          {data.crewName}
        </div>
        <div className="text-[12.5px] text-white/60">
          {data.trade ? `${data.trade} · ` : ""}
          {formatDayLabel(data.day)}
        </div>
        <a
          href={`${base}/api/photo-shares/${token}/report`}
          className="mt-[12px] inline-flex items-center gap-[7px] rounded-[11px] px-[14px] py-[9px] font-display font-bold text-[13px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_6px_20px_rgba(143,106,31,0.34)] active:scale-[0.98] transition-transform"
        >
          <FileDown className="w-[15px] h-[15px]" /> Download full report (PDF)
        </a>
      </header>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[720px] mx-auto">
        <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px] flex items-center gap-[6px]">
          <Camera className="w-[13px] h-[13px]" /> Daily activity ·{" "}
          {data.photos.length} photo{data.photos.length === 1 ? "" : "s"}
        </div>
        {jobKeys.length === 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] text-center text-[13px] text-muted-foreground py-[26px]">
            No activity for this day.
          </div>
        ) : (
          <div className="flex flex-col gap-[18px]">
            {jobKeys.map((k) => {
              const photos = data.photos.filter((p) => keyOf(p.jobId) === k);
              const checkins = data.checkins.filter((c) => keyOf(c.jobId) === k);
              const before = photos.filter((p) => p.phase === "before");
              const after = photos.filter((p) => p.phase === "after");
              const other = photos.filter((p) => p.phase !== "before" && p.phase !== "after");
              return (
                <div key={k} className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
                  <div className="text-[14.5px] font-display font-bold">
                    {labelFor(k)}
                    <span className="text-muted-foreground font-normal font-sans text-[12.5px]">
                      {" "}
                      · {photos.length} photo{photos.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {checkins.length > 0 && (
                    <div className="mt-[8px] border-t border-border pt-[4px] divide-y divide-border/60">
                      {checkins.map((c) => (
                        <CheckinRow key={c.id} c={c} crewName={data.crewName} />
                      ))}
                    </div>
                  )}

                  <PhaseBlock title="Before" photos={before} base={base} tone="before" />
                  <PhaseBlock title="After" photos={after} base={base} tone="after" />
                  <PhaseBlock
                    title={before.length + after.length > 0 ? "More photos" : "Photos"}
                    photos={other}
                    base={base}
                    tone="other"
                  />

                  {photos.length === 0 && (
                    <div className="mt-[8px] text-[12.5px] text-muted-foreground flex items-center gap-[6px]">
                      <ClipboardList className="w-[13px] h-[13px]" /> No photos for this job — check-in activity only.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
