import { useParams } from "wouter";
import {
  useGetPublicJobSummary,
  getGetPublicJobSummaryQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, Download, Flag, Loader2, ShieldCheck } from "lucide-react";
import { FalkonBadge } from "@/components/FalkonBadge";

function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Generic "community box view" template shown until the property manager's own
 * dashboard/CMS is set up: a grid of neutral unit boxes with this job's unit
 * flagged red (or green when nothing was flagged).
 */
function CommunityBoxPreview({
  unit,
  flaggedItems,
}: {
  unit: string;
  flaggedItems: string[];
}) {
  const flagged = flaggedItems.length > 0;
  const boxes = Array.from({ length: 17 }, (_, i) => i);
  return (
    <div className="bg-card rounded-[16px] border border-border shadow-sm p-[18px] mb-[14px]">
      <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-muted-foreground mb-[10px]">
        Community box view
      </div>
      <div className="grid grid-cols-6 gap-[6px]">
        {boxes.slice(0, 8).map((i) => (
          <div key={i} className="aspect-square rounded-[8px] bg-muted" />
        ))}
        <div
          className={`col-span-2 row-span-2 rounded-[10px] p-[8px] flex flex-col items-center justify-center text-center text-white ${
            flagged ? "bg-rose-600" : "bg-emerald-600"
          }`}
          data-testid="box-flagged-unit"
        >
          <div className="font-display font-bold text-[16px] leading-none">
            {unit || "Unit"}
          </div>
          <div className="text-[9px] font-semibold mt-[4px] leading-tight opacity-90 line-clamp-3">
            {flagged ? flaggedItems[0] : "All clear"}
          </div>
        </div>
        {boxes.slice(8).map((i) => (
          <div key={i} className="aspect-square rounded-[8px] bg-muted" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mt-[12px]">
        <p className="text-[11.5px] text-muted-foreground leading-snug">
          {flagged
            ? `${flaggedItems.length} item${flaggedItems.length > 1 ? "s" : ""} flagged in ${unit ? `Unit ${unit}` : "this unit"} — details below.`
            : "Nothing flagged on this visit."}
        </p>
        <a
          href="#summary"
          className="shrink-0 px-4 py-2 rounded-[10px] bg-[var(--gold-light,#B4FF44)] text-black text-[12px] font-bold"
          data-testid="button-view-summary"
        >
          View summary
        </a>
      </div>
    </div>
  );
}

export default function SummaryShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicJobSummary(token, {
    query: { queryKey: getGetPublicJobSummaryQueryKey(token) },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-3" />
          <div className="font-display font-bold text-[18px] text-foreground">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This summary link isn't valid or has been removed.
          </p>
          <div className="mt-8">
            <FalkonBadge />
          </div>
        </div>
      </div>
    );
  }

  const { doc, flaggedItems } = data;
  const where = [doc.propertyName, doc.unitNumber ? `Unit ${doc.unitNumber}` : null]
    .filter(Boolean)
    .join(" · ");
  const resultLabel =
    doc.overallResult === "exceeded"
      ? "Exceeded"
      : doc.overallResult === "followup"
        ? "Follow-up needed"
        : "Met scope";
  const before = doc.photos.filter((p) => p.phase === "before");
  const after = doc.photos.filter((p) => p.phase !== "before");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card border-b border-border px-[18px] pt-[22px] pb-[18px]">
        <div className="max-w-[720px] mx-auto">
          <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-dark)]">
            {doc.business?.companyName ?? "ArchAngel Contractors"}
          </div>
          <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[4px] leading-snug text-foreground">
            {doc.title}
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-[3px]">
            {where}
            {doc.serviceDate ? ` · ${formatDate(doc.serviceDate)}` : ""}
          </div>
          <a
            href={`/api/job-summaries/${token}/pdf`}
            className="inline-flex items-center gap-[6px] mt-[12px] px-4 py-2 rounded-[10px] bg-[var(--gold-light,#B4FF44)] text-black text-[12px] font-bold"
            data-testid="button-download-pdf"
          >
            <Download className="w-[14px] h-[14px]" /> Download PDF
          </a>
        </div>
      </header>

      <main className="px-[14px] py-[16px] pb-[44px] max-w-[720px] mx-auto flex-1 w-full">
        <CommunityBoxPreview unit={doc.unitNumber ?? ""} flaggedItems={flaggedItems} />

        <div id="summary" className="bg-card rounded-[16px] border border-border border-t-[3px] border-t-primary shadow-sm p-[18px] space-y-[18px]">
          {/* Info row */}
          <div className="grid grid-cols-2 gap-[10px] text-[12.5px]">
            {[
              ["Property / site", doc.propertyName],
              ["Unit #", doc.unitNumber],
              ["Location", doc.propertyAddress],
              ["Service date", doc.serviceDate ? formatDate(doc.serviceDate) : null],
              ["Crew lead", doc.crewLead],
              ["Time in / out", [doc.timeIn, doc.timeOut].filter(Boolean).join(" – ") || null],
            ].map(([label, value]) => (
              <div key={label as string}>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
                <div className="font-semibold text-foreground">{value || "—"}</div>
              </div>
            ))}
          </div>

          {/* Checklist */}
          {doc.checklist.map((sec) => (
            <div key={sec.section}>
              <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-[var(--gold-dark)] mb-[6px]">
                {sec.section}
              </div>
              <div className="space-y-[3px]">
                {sec.items.filter((i) => i.checked).map((i) => (
                  <div key={i.label} className="flex items-start gap-[7px] text-[13px] text-foreground/90">
                    <CheckCircle2 className="w-[14px] h-[14px] text-[var(--gold-dark)] mt-[2px] shrink-0" />
                    {i.label}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Flags */}
          {flaggedItems.length > 0 && (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 p-[14px]">
              <div className="flex items-center gap-[6px] text-[12px] font-bold text-rose-700 mb-[6px]">
                <Flag className="w-[14px] h-[14px]" /> While we were there, we noticed…
              </div>
              <ul className="space-y-[3px] text-[13px] text-rose-900 list-disc pl-[18px]">
                {flaggedItems.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {doc.observations && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-[3px]">Additional observations</div>
              <p className="text-[13px] whitespace-pre-wrap text-foreground/90">{doc.observations}</p>
            </div>
          )}
          {doc.touchUpNotes && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-[3px]">Touch-up requests</div>
              <p className="text-[13px] whitespace-pre-wrap text-foreground/90">{doc.touchUpNotes}</p>
            </div>
          )}

          <div className="text-[13px] font-semibold">
            Overall result: <span className="text-[var(--gold-dark)]">{resultLabel}</span>
          </div>

          {/* Photos */}
          {doc.photos.length > 0 && (
            <div>
              <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-[var(--gold-dark)] mb-[8px]">
                Before &amp; after
              </div>
              <div className="grid grid-cols-2 gap-[8px]">
                <div className="space-y-[8px]">
                  {before.map((p) => (
                    <img key={p.path} src={p.url} alt="Before" className="w-full rounded-[10px] object-cover" />
                  ))}
                  {before.length > 0 && <div className="text-[10px] font-bold uppercase text-muted-foreground text-center">Before</div>}
                </div>
                <div className="space-y-[8px]">
                  {after.map((p) => (
                    <img key={p.path} src={p.url} alt="After" className="w-full rounded-[10px] object-cover" />
                  ))}
                  {after.length > 0 && <div className="text-[10px] font-bold uppercase text-muted-foreground text-center">After</div>}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-border pt-[12px] text-center">
            <div className="text-[11px] font-bold text-foreground">
              ✦ THE ARCHANGEL PROMISE — Not satisfied? We return within 24 hours to make it right. No charge.
            </div>
            <div className="text-[11px] text-muted-foreground mt-[4px]">
              {[doc.business?.companyName, doc.business?.phone, doc.business?.email].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <FalkonBadge />
        </div>
      </main>
    </div>
  );
}
