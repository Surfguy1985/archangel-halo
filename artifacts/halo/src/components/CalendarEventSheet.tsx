import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { Link } from "wouter";
import {
  Clock,
  Calendar as CalendarIcon,
  Users,
  Link2,
  Copy,
  Check,
  Pencil,
  Briefcase,
  ChevronRight,
  MapPin,
} from "lucide-react";
import type { CalendarEvent } from "@workspace/api-client-react";

const COLOR_VAR: Record<string, string> = {
  gold: "--gold",
  red: "--red",
  orange: "--orange",
  yellow: "--yellow",
  green: "--green",
  blue: "--blue",
  purple: "--purple",
  ink: "--ink",
};

function colorVar(token: string) {
  return `var(${COLOR_VAR[token] ?? "--gold"})`;
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y!, m! - 1, d!, 12).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const mer = h! >= 12 ? "PM" : "AM";
  const hr = h! % 12 === 0 ? 12 : h! % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${mer}`;
}

export function CalendarEventSheet({
  open,
  onOpenChange,
  event,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  onEdit: (event: CalendarEvent) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  const portalUrl = event.crewPortalToken
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/portal/${event.crewPortalToken}`
    : null;

  const timeLabel = event.allDay
    ? "All-day"
    : event.start
      ? `${fmtTime(event.start)}${event.end ? ` – ${fmtTime(event.end)}` : ""}`
      : "No time set";

  const copyLink = async () => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[86vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[16px]">
            <div className="flex items-start gap-[11px]">
              <span
                className="w-[14px] h-[14px] rounded-full mt-[6px] shrink-0"
                style={{ background: colorVar(event.color) }}
              />
              <div className="min-w-0">
                <SheetTitle className="font-display font-bold text-[20px] leading-[1.2] m-0">
                  {event.title}
                </SheetTitle>
                <div className="text-[12.5px] uppercase tracking-[0.12em] text-muted-foreground mt-[4px]">
                  {event.kind === "job" ? "Scheduled job" : "Calendar note"}
                  {event.status ? ` · ${event.status.replace("_", " ")}` : ""}
                </div>
              </div>
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-[12px] bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)]">
              <CalendarIcon className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
              <div className="text-[14.5px] font-semibold">{fmtDate(event.date)}</div>
            </div>
            <div className="flex items-center gap-[12px] bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)]">
              <Clock className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
              <div className="text-[14.5px] font-semibold">{timeLabel}</div>
            </div>

            {event.propertyName && (
              <div className="flex items-center gap-[12px] bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)]">
                <MapPin className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
                <div className="text-[14.5px] font-semibold">{event.propertyName}</div>
              </div>
            )}

            {event.notes && (
              <div className="bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)]">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-[5px]">
                  Notes
                </div>
                <div className="text-[14px] leading-[1.45] whitespace-pre-wrap">
                  {event.notes}
                </div>
              </div>
            )}

            {event.crewName && (
              <div className="bg-card border border-border rounded-[14px] p-[13px_14px] shadow-[var(--shadow)]">
                <div className="flex items-center gap-[12px]">
                  <Users className="w-[18px] h-[18px] text-[var(--gold-dark)] shrink-0" strokeWidth={1.9} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Crew
                    </div>
                    <div className="text-[15px] font-display font-bold">{event.crewName}</div>
                  </div>
                  {event.crewId && (
                    <Link href={`/crews/${event.crewId}`} onClick={() => onOpenChange(false)}>
                      <span className="flex items-center text-[13px] font-semibold text-[var(--gold-dark)]">
                        Open <ChevronRight className="w-[15px] h-[15px]" />
                      </span>
                    </Link>
                  )}
                </div>

                {portalUrl && (
                  <div className="mt-[12px] pt-[12px] border-t border-border">
                    <div className="flex items-center gap-[7px] text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-[7px]">
                      <Link2 className="w-[13px] h-[13px]" /> Crew portal link
                    </div>
                    <div className="text-[12.5px] text-muted-foreground break-all bg-[var(--paper)] border border-border rounded-[10px] p-[9px_11px] mb-[10px]">
                      {portalUrl}
                    </div>
                    <div className="flex gap-[9px]">
                      <button
                        onClick={copyLink}
                        className="flex-1 rounded-[12px] py-[11px] font-semibold text-[13.5px] flex items-center justify-center gap-[7px] bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
                      >
                        {copied ? (
                          <>
                            <Check className="w-[15px] h-[15px] text-[var(--green)]" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-[15px] h-[15px]" /> Copy link
                          </>
                        )}
                      </button>
                      <a
                        href={`sms:?&body=${encodeURIComponent(
                          `Here's your ArchAngel crew portal link — tap to open:\n${portalUrl}`,
                        )}`}
                        className="flex-1 rounded-[12px] py-[11px] font-display font-bold text-[13.5px] text-[var(--ink)] flex items-center justify-center gap-[7px] bg-[var(--primary)] shadow-[0_5px_16px_rgba(180,255,68,0.35)] transition-transform active:scale-[0.98]"
                      >
                        Send link
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {event.kind === "job" && event.jobId ? (
            <Link href={`/jobs/${event.jobId}`} onClick={() => onOpenChange(false)}>
              <button className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] flex items-center justify-center gap-[8px] transition-transform active:scale-[0.98]">
                <Briefcase className="w-[16px] h-[16px]" /> View job
              </button>
            </Link>
          ) : (
            <button
              onClick={() => onEdit(event)}
              className="w-full mt-[18px] rounded-[13px] py-[13px] font-display font-bold text-[15px] text-[var(--ink)] bg-[var(--primary)] shadow-[0_6px_20px_rgba(180,255,68,0.35)] flex items-center justify-center gap-[8px] transition-transform active:scale-[0.98]"
            >
              <Pencil className="w-[16px] h-[16px]" /> Edit event
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
