import { useParams } from "wouter";
import {
  useGetPhotoShare,
  getGetPhotoShareQueryKey,
} from "@workspace/api-client-react";
import { Camera, Loader2, ShieldCheck } from "lucide-react";

function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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
      </header>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[720px] mx-auto">
        <div className="font-display font-bold text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-[12px] flex items-center gap-[6px]">
          <Camera className="w-[13px] h-[13px]" /> Daily activity ·{" "}
          {data.photos.length} photo{data.photos.length === 1 ? "" : "s"}
        </div>
        {data.photos.length === 0 ? (
          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px] text-center text-[13px] text-muted-foreground py-[26px]">
            No photos for this day.
          </div>
        ) : (
          <div className="flex flex-col gap-[18px]">
            {(() => {
              const map = new Map<string, { label: string; photos: typeof data.photos }>();
              for (const p of data.photos) {
                const key = p.jobId ?? "none";
                const g = map.get(key) ?? {
                  label: p.jobLabel ?? (p.jobId ? "Job" : "General photos"),
                  photos: [],
                };
                g.photos.push(p);
                map.set(key, g);
              }
              return Array.from(map.entries())
                .sort((a, b) => {
                  if (a[0] === "none") return 1;
                  if (b[0] === "none") return -1;
                  return 0;
                })
                .map(([key, g]) => (
                  <div key={key}>
                    <div className="text-[13.5px] font-display font-bold mb-[8px]">
                      {g.label}
                      <span className="text-muted-foreground font-normal font-sans text-[12.5px]">
                        {" "}
                        · {g.photos.length} photo{g.photos.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-[8px]">
                      {g.photos.map((p) => (
                        <a
                          key={p.id}
                          href={`${base}/api/storage${p.storagePath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-square rounded-[12px] overflow-hidden bg-card border border-border shadow-[var(--shadow)]"
                        >
                          <img
                            src={`${base}/api/storage${p.storagePath}`}
                            alt={p.note || "Crew photo"}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ));
            })()}
          </div>
        )}
      </main>
    </div>
  );
}
