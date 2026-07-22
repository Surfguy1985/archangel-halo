import { useParams } from "wouter";
import {
  useGetJobTracker,
  getGetJobTrackerQueryKey,
} from "@workspace/api-client-react";
import {
  Camera,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  ShieldCheck,
  FileText,
} from "lucide-react";

function fmtWhen(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  open: "Not started",
  scheduled: "Scheduled",
  in_progress: "Crew on site",
  complete: "Completed",
};

export default function JobTracker() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetJobTracker(token, {
    query: {
      queryKey: getGetJobTrackerQueryKey(token),
      refetchInterval: 10000,
    },
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
            This tracker link isn't valid or has been removed.
          </p>
        </div>
      </div>
    );
  }

  const where = [data.propertyName, data.unitNo ? `Unit ${data.unitNo}` : null]
    .filter(Boolean)
    .join(" · ");
  const isDone = data.status === "complete";
  const befores = data.photos.filter((p) => p.phase === "before");
  const afters = data.photos.filter((p) => p.phase === "after");
  const others = data.photos.filter(
    (p) => p.phase !== "before" && p.phase !== "after",
  );
  const pairs = Math.max(befores.length, afters.length);

  const photoCell = (
    p: (typeof data.photos)[number] | undefined,
    label: string,
  ) =>
    p ? (
      <a
        href={`${base}${p.url}`}
        target="_blank"
        rel="noreferrer"
        className="block relative rounded-[12px] overflow-hidden bg-card border border-border shadow-[var(--shadow)]"
      >
        <div className="aspect-square">
          <img
            src={`${base}${p.url}`}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="px-[8px] py-[6px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--gold,#8f6a1f)]">
            {label}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            {fmtWhen(p.capturedAt ?? p.createdAt)}
            {p.sha256 ? " · sealed" : ""}
          </div>
        </div>
      </a>
    ) : (
      <div className="rounded-[12px] border border-dashed border-border grid place-items-center aspect-square text-[11px] text-muted-foreground">
        No {label.toLowerCase()} photo yet
      </div>
    );

  return (
    <div className="min-h-screen bg-[var(--bg,#f4f2ee)]">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[22px] pb-[18px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-light)]">
          {data.businessName || "ArchAngel Contractors"} · Live job tracker
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[4px] leading-snug">
          {data.description || `Job ${data.jobNo}`}
        </div>
        <div className="text-[12.5px] text-white/60 mt-[3px]">
          {where}
          {where ? " · " : ""}
          {data.jobNo}
        </div>
        <div
          className={`inline-flex items-center gap-[6px] mt-[10px] rounded-full px-[12px] py-[5px] text-[12px] font-bold ${
            isDone
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-[rgba(196,158,80,0.22)] text-[var(--gold-light)]"
          }`}
        >
          {isDone ? (
            <CheckCircle2 className="w-[14px] h-[14px]" />
          ) : (
            <span className="w-[8px] h-[8px] rounded-full bg-current animate-pulse" />
          )}
          {STATUS_LABEL[data.status] ?? data.status}
          {isDone && data.completedAt ? ` · ${fmtWhen(data.completedAt)}` : ""}
        </div>
      </header>

      <main className="px-[14px] py-[16px] pb-[44px] max-w-[720px] mx-auto">
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[14px]">
          <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
            Job details
          </div>
          <div className="grid grid-cols-2 gap-y-[8px] text-[13.5px]">
            <div className="text-muted-foreground">Job number</div>
            <div className="font-semibold text-right">{data.jobNo}</div>
            {data.category && (
              <>
                <div className="text-muted-foreground">Service</div>
                <div className="font-semibold text-right capitalize">{data.category}</div>
              </>
            )}
            {data.crewName && (
              <>
                <div className="text-muted-foreground">Crew</div>
                <div className="font-semibold text-right">
                  {data.crewName}
                  {data.crewTrade ? ` · ${data.crewTrade}` : ""}
                </div>
              </>
            )}
            {data.scheduledOn && (
              <>
                <div className="text-muted-foreground">Scheduled</div>
                <div className="font-semibold text-right">{data.scheduledOn}</div>
              </>
            )}
          </div>
          {data.description && (
            <div className="mt-[10px] pt-[10px] border-t border-border text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {data.description}
            </div>
          )}
        </div>

        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[14px]">
          <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px] flex items-center gap-[6px]">
            <MapPin className="w-[13px] h-[13px]" /> GPS time on site
          </div>
          {data.checkins.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">
              The crew hasn't checked in yet. This page updates automatically.
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {data.checkins.map((c) => (
                <div key={c.id} className="flex items-start gap-[10px]">
                  <div
                    className={`w-[30px] h-[30px] rounded-full grid place-items-center shrink-0 ${
                      c.kind === "checkout"
                        ? "bg-[var(--ink)] text-white"
                        : "bg-[rgba(143,106,31,0.14)] text-[var(--gold,#8f6a1f)]"
                    }`}
                  >
                    {c.kind === "checkout" ? (
                      <LogOut className="w-[14px] h-[14px]" />
                    ) : (
                      <LogIn className="w-[14px] h-[14px]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold">
                      {c.kind === "checkout" ? "Checked out" : "Checked in"} ·{" "}
                      {fmtWhen(c.createdAt)}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {c.crewName ?? "Crew"}
                      {c.lat != null && c.lng != null
                        ? ` · GPS verified (±${Math.round(c.accuracy ?? 0)} m)`
                        : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {data.workNotes.length > 0 && (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] border-t-[3px] border-[var(--gold,#8f6a1f)] p-[15px] mb-[14px]">
            <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px] flex items-center gap-[6px]">
              <FileText className="w-[13px] h-[13px]" /> Work completed
            </div>
            {data.workNotes.map((n, i) => (
              <div key={i} className={i > 0 ? "mt-[10px] pt-[10px] border-t border-border" : ""}>
                <div className="text-[14px] leading-relaxed whitespace-pre-wrap">"{n.note}"</div>
                <div className="text-[11.5px] text-muted-foreground mt-[4px]">
                  — {n.crewName ?? "Crew"}, {fmtWhen(n.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}

        {(pairs > 0 || others.length > 0) && (
          <div className="mb-[14px]">
            <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px] flex items-center gap-[6px]">
              <Camera className="w-[13px] h-[13px]" /> Photo evidence ·{" "}
              {data.photos.length} photo{data.photos.length === 1 ? "" : "s"}
            </div>
            {pairs > 0 && (
              <div className="flex flex-col gap-[8px] mb-[8px]">
                {Array.from({ length: pairs }).map((_, i) => (
                  <div key={i} className="grid grid-cols-2 gap-[8px]">
                    {photoCell(befores[i], "Before")}
                    {photoCell(afters[i], "After")}
                  </div>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
                {others.map((p) => (
                  <a
                    key={p.id}
                    href={`${base}${p.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[12px] overflow-hidden bg-card border border-border shadow-[var(--shadow)]"
                  >
                    <div className="aspect-square">
                      <img
                        src={`${base}${p.url}`}
                        alt={p.note || "Job photo"}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[14px] flex items-start gap-[10px]">
          <ShieldCheck className="w-[18px] h-[18px] text-[var(--gold,#8f6a1f)] shrink-0 mt-[1px]" />
          <div className="text-[12px] text-muted-foreground leading-relaxed">
            <b className="text-foreground">Tamper-evident record.</b> Every photo
            is digitally fingerprinted (SHA-256) the moment it's uploaded from
            the crew's phone, and GPS check-ins are recorded with time and
            location. These records can't be edited after the fact.
          </div>
        </div>

        <div className="text-[12px] text-muted-foreground leading-relaxed border-t border-border mt-[6px] pt-[12px]">
          {data.businessName || "ArchAngel Contractors"} · Live tracker powered
          by HALO. This page refreshes automatically as the crew works.
        </div>
      </main>
    </div>
  );
}
