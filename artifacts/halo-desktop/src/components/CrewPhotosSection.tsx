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
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-[var(--ink)]">Photos from crews</h2>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Camera className="w-4 h-4" /> {photos.length}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {photos.map((p) => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block bg-card rounded-xl shadow-sm border border-border overflow-hidden hover:shadow-md transition-shadow"
          >
            <img
              src={p.url}
              alt={p.note || "Crew photo"}
              loading="lazy"
              className="w-full aspect-[4/3] object-cover"
            />
            <div className="p-2.5">
              <div className="text-xs font-semibold truncate">
                {showJob
                  ? [p.jobNo, p.unitNo ? `Unit ${p.unitNo}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Job photo"
                  : p.crewName || "Crew photo"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {[
                  showJob ? p.crewName : null,
                  new Date(`${p.takenOn}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  }),
                  p.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
