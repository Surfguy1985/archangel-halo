import { useParams } from "wouter";
import {
  useGetRecapShare,
  getGetRecapShareQueryKey,
} from "@workspace/api-client-react";
import { Camera, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function RecapShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetRecapShare(token, {
    query: { queryKey: getGetRecapShareQueryKey(token) },
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
            This recap link isn't valid or has been removed.
          </p>
        </div>
      </div>
    );
  }

  const where = [data.propertyName, data.unitNo ? `Unit ${data.unitNo}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen bg-[var(--bg,#f4f2ee)]">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[22px] pb-[18px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-light)]">
          ArchAngel Contractors
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[4px] leading-snug">
          {data.subject}
        </div>
        <div className="text-[12.5px] text-white/60 mt-[3px]">
          {where}
          {where ? " · " : ""}
          {data.jobNo}
        </div>
      </header>

      <main className="px-[14px] py-[16px] pb-[44px] max-w-[720px] mx-auto">
        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] border-t-[3px] border-[var(--gold,#8f6a1f)] p-[18px] mb-[14px]">
          <div className="flex items-center gap-[7px] text-[12px] font-semibold text-emerald-700 mb-[10px]">
            <CheckCircle2 className="w-[15px] h-[15px]" />
            Work completed
            {data.completedAt ? ` · ${formatDate(data.completedAt)}` : ""}
          </div>
          <div className="text-[14.5px] leading-[1.75] whitespace-pre-wrap">
            {data.body}
          </div>
        </div>

        <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] mb-[14px]">
          <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px]">
            Job details
          </div>
          <div className="grid grid-cols-2 gap-y-[8px] text-[13.5px]">
            <div className="text-muted-foreground">Job number</div>
            <div className="font-semibold text-right">{data.jobNo}</div>
            {data.propertyName && (
              <>
                <div className="text-muted-foreground">Property</div>
                <div className="font-semibold text-right">{data.propertyName}</div>
              </>
            )}
            {data.unitNo && (
              <>
                <div className="text-muted-foreground">Unit</div>
                <div className="font-semibold text-right">{data.unitNo}</div>
              </>
            )}
            {data.category && (
              <>
                <div className="text-muted-foreground">Service</div>
                <div className="font-semibold text-right capitalize">{data.category}</div>
              </>
            )}
            {data.crewName && (
              <>
                <div className="text-muted-foreground">Crew</div>
                <div className="font-semibold text-right">{data.crewName}</div>
              </>
            )}
            {data.completedAt && (
              <>
                <div className="text-muted-foreground">Completed</div>
                <div className="font-semibold text-right">{formatDate(data.completedAt)}</div>
              </>
            )}
          </div>
        </div>

        {data.photos.length > 0 && (
          <div>
            <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[10px] flex items-center gap-[6px]">
              <Camera className="w-[13px] h-[13px]" /> Photo documentation ·{" "}
              {data.photos.length} photo{data.photos.length === 1 ? "" : "s"}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
              {data.photos.map((p, i) => (
                <a
                  key={i}
                  href={`${base}${p.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-[12px] overflow-hidden bg-card border border-border shadow-[var(--shadow)]"
                >
                  <div className="aspect-square">
                    <img
                      src={`${base}${p.url}`}
                      alt={p.label}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground px-[8px] py-[5px]">
                    {p.label}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="text-[12px] text-muted-foreground leading-relaxed border-t border-border mt-[20px] pt-[12px]">
          ArchAngel Contractors · Shared via HALO. Questions? Just reply to the
          text that brought you here — we're happy to help.
        </div>
      </main>
    </div>
  );
}
