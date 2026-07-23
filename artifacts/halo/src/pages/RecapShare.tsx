import { useParams } from "wouter";
import {
  useGetRecapShare,
  getGetRecapShareQueryKey,
} from "@workspace/api-client-react";
import { Camera, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";

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
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary drop-shadow-[0_0_10px_rgba(180,255,68,0.5)]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-primary drop-shadow-[0_0_10px_rgba(180,255,68,0.5)] mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This recap link isn't valid or has been removed.
          </p>
          <div className="mt-8">
            <FalkonBadge />
          </div>
        </div>
      </div>
    );
  }

  const where = [data.propertyName, data.unitNo ? `Unit ${data.unitNo}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[22px] pb-[18px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-primary drop-shadow-[0_0_8px_rgba(180,255,68,0.4)]">
          ArchAngel Contractors
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[4px] leading-snug text-foreground">
          {data.subject}
        </div>
        <div className="text-[12.5px] text-muted-foreground mt-[3px]">
          {where}
          {where ? " · " : ""}
          <span className="text-foreground">{data.jobNo}</span>
        </div>
      </header>

      <main className="px-[14px] py-[16px] pb-[44px] max-w-[720px] mx-auto flex-1 w-full">
        <div className="bg-card rounded-[16px] border border-border border-t-[3px] border-t-primary shadow-[0_0_20px_rgba(180,255,68,0.05)] p-[18px] mb-[14px]">
          <div className="flex items-center gap-[7px] text-[12px] font-semibold text-primary mb-[10px]">
            <CheckCircle2 className="w-[15px] h-[15px] drop-shadow-[0_0_5px_rgba(180,255,68,0.5)]" />
            Work completed
            <span className="text-muted-foreground font-normal">{data.completedAt ? ` · ${formatDate(data.completedAt)}` : ""}</span>
          </div>
          <div className="text-[14.5px] leading-[1.75] whitespace-pre-wrap text-foreground/90">
            {data.body}
          </div>
        </div>

        <div className="bg-card border border-border rounded-[16px] p-[15px] mb-[14px]">
          <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-primary drop-shadow-[0_0_5px_rgba(180,255,68,0.3)] mb-[12px]">
            Job details
          </div>
          <div className="grid grid-cols-2 gap-y-[10px] text-[13.5px]">
            <div className="text-muted-foreground">Job number</div>
            <div className="font-semibold text-right text-foreground">{data.jobNo}</div>
            {data.propertyName && (
              <>
                <div className="text-muted-foreground">Property</div>
                <div className="font-semibold text-right text-foreground">{data.propertyName}</div>
              </>
            )}
            {data.unitNo && (
              <>
                <div className="text-muted-foreground">Unit</div>
                <div className="font-semibold text-right text-foreground">{data.unitNo}</div>
              </>
            )}
            {data.category && (
              <>
                <div className="text-muted-foreground">Service</div>
                <div className="font-semibold text-right capitalize text-foreground">{data.category}</div>
              </>
            )}
            {data.crewName && (
              <>
                <div className="text-muted-foreground">Crew</div>
                <div className="font-semibold text-right text-foreground">{data.crewName}</div>
              </>
            )}
            {data.completedAt && (
              <>
                <div className="text-muted-foreground">Completed</div>
                <div className="font-semibold text-right text-foreground">{formatDate(data.completedAt)}</div>
              </>
            )}
          </div>
        </div>

        {data.photos.length > 0 && (
          <div className="mt-[20px]">
            <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px] flex items-center gap-[6px]">
              <Camera className="w-[14px] h-[14px] text-primary" /> Photo documentation ·{" "}
              <span className="text-foreground">{data.photos.length} photo{data.photos.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
              {data.photos.map((p, i) => (
                <a
                  key={i}
                  href={`${base}${p.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-[12px] overflow-hidden bg-card border border-border shadow-[0_0_10px_rgba(0,0,0,0.5)] hover:border-primary transition-colors group"
                >
                  <div className="aspect-square relative">
                    <img
                      src={`${base}${p.url}`}
                      alt={p.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                    <div className="absolute bottom-[8px] left-[8px] text-[10px] font-bold uppercase tracking-[0.08em] text-white drop-shadow-md">
                      {p.label}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="text-[12px] text-muted-foreground leading-relaxed border-t border-border mt-[24px] pt-[16px] mb-[12px]">
          ArchAngel Contractors · Shared via HALO. Questions? Just reply to the
          text that brought you here — we're happy to help.
        </div>
      </main>

      <div className="pb-8">
        <FalkonBadge />
      </div>
    </div>
  );
}
