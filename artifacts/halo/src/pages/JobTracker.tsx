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
import { FalkonBadge } from "@/components/FalkonBadge";

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
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-display font-bold text-[18px]">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This tracker link isn't valid or has been removed.
          </p>
        </div>
        <FalkonBadge className="absolute bottom-8 left-0 right-0" />
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
        className="block relative rounded-[16px] overflow-hidden bg-card border border-[var(--hairline)]"
      >
        <div className="aspect-square">
          <img
            src={`${base}${p.url}`}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="px-[12px] py-[10px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
            {label}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {fmtWhen(p.capturedAt ?? p.createdAt)}
            {p.sha256 ? " · sealed" : ""}
          </div>
        </div>
      </a>
    ) : (
      <div className="rounded-[16px] border border-dashed border-[var(--hairline)] grid place-items-center aspect-square text-[11px] text-muted-foreground bg-black/[0.02]">
        No {label.toLowerCase()} photo yet
      </div>
    );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-[var(--hairline)] px-[20px] pt-[32px] pb-[24px] lg:px-0">
        <div className="lg:max-w-[1080px] lg:mx-auto lg:px-[24px]">
        <div className="text-[11px] font-display font-bold tracking-[0.2em] uppercase text-[var(--gold-dark)]">
          {data.businessName || "ArchAngel Contractors"} · Live job tracker
        </div>
        <div className="font-display font-bold text-[28px] tracking-tight mt-[8px] leading-tight text-foreground">
          {data.description || `Job ${data.jobNo}`}
        </div>
        <div className="text-[13px] text-muted-foreground mt-[6px]">
          {where}
          {where ? " · " : ""}
          <span className="text-foreground/80">{data.jobNo}</span>
        </div>
        <div
          className={`inline-flex items-center gap-[8px] mt-[16px] rounded-full px-[14px] py-[6px] text-[12px] font-bold border ${
            isDone
              ? "bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]"
              : "bg-muted text-foreground border-border"
          }`}
        >
          {isDone ? (
            <CheckCircle2 className="w-[14px] h-[14px]" />
          ) : (
            <span className="w-[8px] h-[8px] rounded-full bg-[var(--gold)]" />
          )}
          {STATUS_LABEL[data.status] ?? data.status}
          {isDone && data.completedAt ? ` · ${fmtWhen(data.completedAt)}` : ""}
        </div>
        </div>
      </header>

      <main className="px-[16px] py-[24px] pb-[44px] max-w-[720px] mx-auto lg:max-w-[1080px] lg:px-[24px] lg:py-[32px] lg:grid lg:grid-cols-2 lg:gap-x-[28px] lg:items-start">
        <div className="min-w-0">
        <div className="bg-card rounded-[24px] border border-[var(--hairline)] p-[20px] mb-[16px]">
          <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--gold-dark)] mb-[16px]">
            Job details
          </div>
          <div className="grid grid-cols-2 gap-y-[12px] text-[14px]">
            <div className="text-muted-foreground">Job number</div>
            <div className="font-medium text-right text-foreground">{data.jobNo}</div>
            {data.category && (
              <>
                <div className="text-muted-foreground">Service</div>
                <div className="font-medium text-right text-foreground capitalize">{data.category}</div>
              </>
            )}
            {data.crewName && (
              <>
                <div className="text-muted-foreground">Crew</div>
                <div className="font-medium text-right text-foreground">
                  {data.crewName}
                  {data.crewTrade ? ` · ${data.crewTrade}` : ""}
                </div>
              </>
            )}
            {data.scheduledOn && (
              <>
                <div className="text-muted-foreground">Scheduled</div>
                <div className="font-medium text-right text-foreground">{data.scheduledOn}</div>
              </>
            )}
          </div>
          {data.description && (
            <div className="mt-[16px] pt-[16px] border-t border-[var(--hairline)] text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {data.description}
            </div>
          )}
        </div>

        <div className="bg-card rounded-[24px] border border-[var(--hairline)] p-[20px] mb-[16px]">
          <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--gold-dark)] mb-[16px] flex items-center gap-[8px]">
            <MapPin className="w-[14px] h-[14px]" /> GPS time on site
          </div>
          {data.checkins.length === 0 ? (
            <div className="text-[14px] text-muted-foreground bg-black/[0.02] p-[16px] rounded-[16px] border border-[var(--hairline)] text-center">
              The crew hasn't checked in yet. This page updates automatically.
            </div>
          ) : (
            <div className="flex flex-col gap-[16px]">
              {data.checkins.map((c, idx) => (
                <div key={c.id} className={`flex items-start gap-[12px] ${idx > 0 ? "pt-[16px] border-t border-[var(--hairline)]" : ""}`}>
                  <div
                    className={`w-[36px] h-[36px] rounded-full grid place-items-center shrink-0 border ${
                      c.kind === "checkout"
                        ? "bg-muted text-foreground border-border"
                        : "bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]"
                    }`}
                  >
                    {c.kind === "checkout" ? (
                      <LogOut className="w-[16px] h-[16px]" />
                    ) : (
                      <LogIn className="w-[16px] h-[16px]" />
                    )}
                  </div>
                  <div className="min-w-0 pt-[2px]">
                    <div className="text-[14px] font-bold text-foreground mb-[2px]">
                      {c.kind === "checkout" ? "Checked out" : "Checked in"} ·{" "}
                      <span className="font-medium text-foreground/80">{fmtWhen(c.createdAt)}</span>
                    </div>
                    <div className="text-[12px] text-muted-foreground leading-relaxed">
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
          <div className="bg-card rounded-[24px] border border-border p-[20px] mb-[16px]">
            <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--gold-dark)] mb-[16px] flex items-center gap-[8px]">
              <FileText className="w-[14px] h-[14px]" /> Work completed
            </div>
            {data.workNotes.map((n, i) => (
              <div key={i} className={i > 0 ? "mt-[16px] pt-[16px] border-t border-border" : ""}>
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-foreground font-medium">"{n.note}"</div>
                <div className="text-[12px] text-muted-foreground mt-[6px]">
                  — {n.crewName ?? "Crew"}, {fmtWhen(n.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>

        <div className="min-w-0">
        {(pairs > 0 || others.length > 0) && (
          <div className="mb-[16px]">
            <div className="font-display font-bold text-[11px] tracking-[0.2em] uppercase text-[var(--gold-dark)] mb-[16px] flex items-center gap-[8px] px-[4px]">
              <Camera className="w-[14px] h-[14px]" /> Photo evidence ·{" "}
              <span className="text-muted-foreground">{data.photos.length} photo{data.photos.length === 1 ? "" : "s"}</span>
            </div>
            {pairs > 0 && (
              <div className="flex flex-col gap-[12px] mb-[12px]">
                {Array.from({ length: pairs }).map((_, i) => (
                  <div key={i} className="grid grid-cols-2 gap-[12px]">
                    {photoCell(befores[i], "Before")}
                    {photoCell(afters[i], "After")}
                  </div>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-[12px]">
                {others.map((p) => (
                  <a
                    key={p.id}
                    href={`${base}${p.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[16px] overflow-hidden bg-card border border-[var(--hairline)]"
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

        <div className="bg-card rounded-[24px] border border-[var(--hairline)] p-[20px] mb-[24px] flex items-start gap-[12px]">
          <ShieldCheck className="w-[20px] h-[20px] text-[var(--gold)] shrink-0 mt-[2px]" />
          <div className="text-[13px] text-muted-foreground leading-relaxed">
            <b className="text-foreground">Tamper-evident record.</b> Every photo
            is digitally fingerprinted (SHA-256) the moment it's uploaded from
            the crew's phone, and GPS check-ins are recorded with time and
            location. These records can't be edited after the fact.
          </div>
        </div>
        </div>

        <div className="lg:col-span-2">
        <div className="text-[12px] text-muted-foreground/60 leading-relaxed text-center px-[20px]">
          {data.businessName || "ArchAngel Contractors"} · Live tracker powered
          by HALO. This page refreshes automatically as the crew works.
        </div>
        
        <FalkonBadge className="mt-12" />
        </div>
      </main>
    </div>
  );
}
