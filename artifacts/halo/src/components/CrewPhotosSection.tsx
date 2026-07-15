import type { CrewJobPhoto } from "@workspace/api-client-react";
import { Camera } from "lucide-react";

export function CrewPhotosSection({
  photos,
  showJob = false,
}: {
  photos: CrewJobPhoto[];
  showJob?: boolean;
}) {
  if (photos.length === 0) return null;
  return (
    <div className="mb-[18px]">
      <div className="flex items-center justify-between mb-[8px] mx-[2px]">
        <div className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-muted-foreground">
          Photos from crews
        </div>
        <div className="flex items-center gap-[4px] text-[12px] text-muted-foreground">
          <Camera className="w-[13px] h-[13px]" /> {photos.length}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[9px]">
        {photos.map((p) => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block bg-card rounded-[14px] shadow-[var(--shadow)] overflow-hidden active:scale-[0.98] transition-transform"
          >
            <img
              src={p.url}
              alt={p.note || "Crew photo"}
              loading="lazy"
              className="w-full aspect-[4/3] object-cover"
            />
            <div className="p-[8px_10px]">
              <div className="text-[11.5px] font-semibold truncate">
                {showJob
                  ? [p.jobNo, p.unitNo ? `Unit ${p.unitNo}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Job photo"
                  : p.crewName || "Crew photo"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {[
                  showJob ? p.crewName : null,
                  new Date(`${p.takenOn}T00:00:00`).toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric" },
                  ),
                  p.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
