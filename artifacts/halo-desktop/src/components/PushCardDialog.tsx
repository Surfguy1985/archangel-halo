// Push-a-card composer — the office's "update the client" surface.
// Extracted from ClientBoardOffice so Today, JobDetail, and InvoiceDetail can
// all open the same dialog, optionally prefilled with a template + source
// (e.g. "share the live tracker for this job"). Dedupe rides on
// sourceType/sourceId via the server's raiseClientCard pipeline.
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePushClientBoardCard,
  useGetClientBoardPushQuickPicks,
  getGetClientBoardPushQuickPicksQueryKey,
  useListClientAccounts,
  getGetOfficeClientBoardQueryKey,
  type ClientCardPushInput,
} from "@workspace/api-client-react";
import {
  Briefcase,
  CalendarClock,
  Camera,
  CheckCircle2,
  CreditCard,
  FileText,
  Flag,
  Link2,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  Send,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export type PushTemplate = {
  id: string;
  kind: ClientCardPushInput["kind"];
  label: string;
  desc: string;
  icon: typeof FileText;
  gradient: string;
  textColor: string;
  quick?: "invoices" | "trackers" | "summaries" | "photos" | "bids";
  money?: boolean;
  due?: boolean;
  titlePrefill?: string;
  bodyPlaceholder?: string;
  linkLabel?: string;
  multiSelect?: boolean;
  requireUrl?: boolean;
};

export type PushPrefill = {
  /** TEMPLATES id to preselect, e.g. "crew_on_site", "photos", "invoice", "job_recap". */
  templateId: string;
  title?: string;
  body?: string;
  amount?: number | null;
  dueDate?: string | null;
  linkUrl?: string | null;
  source?: { type: string; id: string; jobId?: string } | null;
};
const TEMPLATES: PushTemplate[] = [
  {
    id: "live_crew_map",
    kind: "crewmap",
    label: "Live Crew Map",
    desc: "Map of current crews",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
    titlePrefill: "Live crew on your site",
  },
  {
    id: "invoice_batch",
    kind: "invoice_batch",
    label: "Invoice Batch",
    desc: "Multiple invoices",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
    quick: "invoices",
    multiSelect: true,
    titlePrefill: "Invoices — ",
    linkLabel: "Pay invoices",
  },
  {
    id: "bid",
    kind: "bid",
    label: "Bid / Proposal",
    desc: "Send a proposal",
    icon: Briefcase,
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-500",
    textColor: "text-white",
    quick: "bids",
    titlePrefill: "Proposal ",
    linkLabel: "View proposal",
  },
  {
    id: "document",
    kind: "document",
    label: "Document / PDF",
    desc: "Share a file link",
    icon: Link2,
    gradient: "bg-gradient-to-br from-slate-400 to-slate-500",
    textColor: "text-white",
    requireUrl: true,
    linkLabel: "View document",
  },
  {
    id: "invoice",
    kind: "invoice",
    label: "Invoice",
    desc: "Bill with a pay link",
    icon: FileText,
    gradient: "bg-gradient-to-br from-amber-400 to-amber-500",
    textColor: "text-white",
    quick: "invoices",
    money: true,
    linkLabel: "Pay now",
  },
  {
    id: "payment",
    kind: "payment_request",
    label: "Payment notice",
    desc: "Payment due or received",
    icon: CreditCard,
    gradient: "bg-gradient-to-br from-emerald-400 to-emerald-500",
    textColor: "text-white",
    quick: "invoices",
    money: true,
    linkLabel: "Pay now",
  },
  {
    id: "crew_on_site",
    kind: "tracker",
    label: "Crew on site",
    desc: "Live tracker + scope",
    icon: MapPin,
    gradient: "bg-gradient-to-br from-violet-400 to-violet-500",
    textColor: "text-white",
    quick: "trackers",
    bodyPlaceholder: "Short scope summary — what the crew is doing today",
    linkLabel: "Watch live",
  },
  {
    id: "job_recap",
    kind: "summary",
    label: "Job recap",
    desc: "Service summary",
    icon: CheckCircle2,
    gradient: "bg-gradient-to-br from-sky-400 to-sky-500",
    textColor: "text-white",
    quick: "summaries",
    bodyPlaceholder: "What got done, in one or two lines",
  },
  {
    id: "photos",
    kind: "photos",
    label: "Photos",
    desc: "Before & after gallery",
    icon: Camera,
    gradient: "bg-gradient-to-br from-pink-400 to-pink-500",
    textColor: "text-white",
    quick: "photos",
    titlePrefill: "Job photos",
    linkLabel: "View photos",
  },
  {
    id: "new_job",
    kind: "manual",
    label: "New job created",
    desc: "Work scheduled",
    icon: Briefcase,
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-500",
    textColor: "text-white",
    quick: "trackers",
    titlePrefill: "New job created",
    bodyPlaceholder: "What the job covers and when it starts",
  },
  {
    id: "reminder",
    kind: "manual",
    label: "Schedule reminder",
    desc: "A date to know about",
    icon: CalendarClock,
    gradient: "bg-gradient-to-br from-orange-400 to-orange-500",
    textColor: "text-white",
    due: true,
    bodyPlaceholder: "What's happening and what (if anything) you need to do",
  },
  {
    id: "flag",
    kind: "flag",
    label: "Flagged item",
    desc: "Auto-attaches flagged items by unit",
    icon: Flag,
    gradient: "bg-gradient-to-br from-red-400 to-red-500",
    textColor: "text-white",
    bodyPlaceholder: "Why it's flagged — from the summary or walkthrough",
  },
  {
    id: "referral",
    kind: "referral",
    label: "Refer us",
    desc: "Ask for a referral",
    icon: Users,
    gradient: "bg-gradient-to-br from-teal-400 to-teal-500",
    textColor: "text-white",
    titlePrefill: "Know another PM?",
    bodyPlaceholder: "We'd love an intro.",
  },
  {
    id: "note",
    kind: "manual",
    label: "Note",
    desc: "Anything else",
    icon: StickyNote,
    gradient: "bg-gradient-to-br from-slate-300 to-slate-400",
    textColor: "text-slate-700",
  },
];

export function PushCardDialog({
  propertyId,
  open,
  onOpenChange,
  prefill,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: PushPrefill | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const push = usePushClientBoardCard();

  const [targetId, setTargetId] = useState(propertyId);
  const [template, setTemplate] = useState<PushTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("Open");
  const [source, setSource] = useState<{ type: string; id: string; jobId?: string } | null>(null);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        // Manual /api URLs must stay root-absolute in the desktop app.
        const r = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        if (!r.ok) throw new Error("Could not start the upload");
        const { uploadURL, objectPath } = await r.json();
        const put = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}`);
        setAttachments((prev) => [...prev, { name: file.name, url: `/api/storage${objectPath}` }]);
      }
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const { data: accounts } = useListClientAccounts({
    query: { queryKey: ["push-card-accounts"], enabled: open },
  });

  const { data: quickPicks } = useGetClientBoardPushQuickPicks(targetId, {
    query: {
      queryKey: getGetClientBoardPushQuickPicksQueryKey(targetId),
      enabled: open && !!targetId,
    },
  });

  const resetFields = () => {
    setTitle("");
    setBody("");
    setAmount("");
    setDueDate("");
    setLinkUrl("");
    setLinkLabel("Open");
    setSource(null);
    setSourceIds([]);
    setAttachments([]);
  };

  useEffect(() => {
    if (open) {
      setTargetId(propertyId);
      setTemplate(null);
      resetFields();
      if (prefill) {
        const t = TEMPLATES.find((x) => x.id === prefill.templateId);
        if (t) {
          setTemplate(t);
          setTitle(prefill.title ?? t.titlePrefill ?? "");
          setLinkLabel(t.linkLabel ?? "Open");
          if (prefill.body) setBody(prefill.body);
          if (prefill.amount != null) setAmount(String(prefill.amount));
          if (prefill.dueDate) setDueDate(prefill.dueDate);
          if (prefill.linkUrl) setLinkUrl(prefill.linkUrl);
          if (prefill.source) setSource(prefill.source);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, propertyId, prefill]);

  const handleTemplate = (t: PushTemplate) => {
    setTemplate(t);
    resetFields();
    setTitle(t.titlePrefill ?? "");
    setLinkLabel(t.linkLabel ?? "Open");
  };

  const submit = () => {
    const data = {
      kind: template!.kind,
      title: title.trim(),
      body: body.trim() || null,
      amount: amount ? Number(amount) : null,
      dueDate: dueDate || null,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkUrl.trim() ? linkLabel.trim() : null,
      sourceType: source?.type || null,
      sourceId: source?.id || null,
      sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      jobId: source?.jobId || null,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    push.mutate(
      { propertyId: targetId, data },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetOfficeClientBoardQueryKey(targetId) });
          toast({
            title: "Card pushed",
            description: res.notified ? "Instant email sent to client." : "Added silently to the board.",
          });
          onOpenChange(false);
        },
        onError: (err: Error) =>
          toast({ title: "Failed to push", description: err.message, variant: "destructive" }),
      }
    );
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[#B4FF44] transition-shadow";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background flex flex-col sm:rounded-3xl h-[85vh] sm:h-auto">
        <div className="p-6 border-b border-border bg-card shrink-0">
          <DialogTitle className="text-xl font-display font-bold">Push a new card</DialogTitle>
          <div className="text-sm font-medium text-muted-foreground mt-1">
            Send an interactive module to the client's board immediately.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
          {!template ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTemplate(t)}
                    className="flex flex-col items-center text-center p-4 rounded-2xl border border-border bg-card hover:border-[#B4FF44] hover:shadow-sm transition-all group"
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-sm ${t.gradient} group-hover:scale-105 transition-transform`}>
                      <Icon className={`w-6 h-6 ${t.textColor}`} />
                    </div>
                    <div className="text-sm font-bold text-foreground mb-1">{t.label}</div>
                    <div className="text-[11px] font-medium text-muted-foreground">{t.desc}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="flex items-center justify-between bg-card p-3 rounded-2xl border border-border">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${template.gradient}`}>
                    <template.icon className={`w-5 h-5 ${template.textColor}`} />
                  </div>
                  <div>
                    <div className="text-sm font-bold">{template.label}</div>
                    <div className="text-xs text-muted-foreground font-medium">Configure payload</div>
                  </div>
                </div>
                <button
                  onClick={() => setTemplate(null)}
                  className="px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  Change type
                </button>
              </div>

              {accounts && accounts.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Target account</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className={inputCls}
                  >
                    {accounts.map((a) => (
                      <option key={a.propertyId} value={a.propertyId}>
                        {a.propertyName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {template.quick && quickPicks && (
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Quick pick from {template.quick}</label>
                  {template.quick === "invoices" && quickPicks.invoices.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No open invoices to pick from.</div>
                  )}
                  {template.quick === "invoices" && template.multiSelect && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {quickPicks.invoices.map((inv) => {
                          const isSelected = sourceIds.includes(inv.id);
                          return (
                            <button
                              key={inv.id}
                              onClick={() => {
                                const newIds = isSelected 
                                  ? sourceIds.filter(id => id !== inv.id) 
                                  : [...sourceIds, inv.id];
                                setSourceIds(newIds);
                                
                                const total = quickPicks.invoices
                                  .filter(i => newIds.includes(i.id))
                                  .reduce((sum, i) => sum + i.amount, 0);
                                  
                                setAmount(total > 0 ? total.toString() : "");
                                
                                const monthName = new Date().toLocaleString('en-US', { month: 'long' });
                                setTitle(`Invoices — ${monthName}`);
                              }}
                              className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                                isSelected ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-[#041029] border-[#041029]' : 'border-border'}`}>
                                  {isSelected && <CheckCircle2 className="w-3 h-3 text-[#B4FF44]" />}
                                </div>
                                <div>
                                  <div className="text-sm font-bold">Inv {inv.invoiceNo}</div>
                                  <div className="text-xs text-muted-foreground">
                                    ${inv.amount.toFixed(2)} {inv.dueDate && ` • Due ${inv.dueDate}`}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {sourceIds.length > 0 && (
                        <div className="text-sm font-medium text-amber-600 bg-amber-50 p-2 rounded-lg inline-block">
                          {sourceIds.length} invoice{sourceIds.length === 1 ? "" : "s"} selected
                        </div>
                      )}
                    </div>
                  )}
                  {template.quick === "invoices" && !template.multiSelect && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.invoices.map((inv) => (
                        <button
                          key={inv.id}
                          onClick={() => {
                            setSource({ type: "invoice", id: inv.id });
                            setTitle(`Invoice ${inv.invoiceNo}`);
                            setAmount(inv.amount.toString());
                            setDueDate(inv.dueDate ?? "");
                            if (inv.payUrl) setLinkUrl(inv.payUrl);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === inv.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Inv {inv.invoiceNo}</div>
                          <div className="text-xs text-muted-foreground">
                            ${inv.amount.toFixed(2)} {inv.dueDate && ` • Due ${inv.dueDate}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "bids" && quickPicks.bids?.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No active proposals to pick from.</div>
                  )}
                  {template.quick === "bids" && quickPicks.bids && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.bids.map((bid: any) => (
                        <button
                          key={bid.id}
                          onClick={() => {
                            setSource({ type: "bid", id: bid.id });
                            setTitle(`Proposal ${bid.bidNo}`);
                            setAmount(bid.amount.toString());
                            if (bid.scope) setBody(bid.scope);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === bid.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Proposal {bid.bidNo} {bid.unitNo && ` • Unit ${bid.unitNo}`}</div>
                          <div className="text-xs text-muted-foreground">
                            ${bid.amount.toFixed(2)} • {bid.status}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "trackers" && quickPicks.trackers.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No active trackers today.</div>
                  )}
                  {template.quick === "trackers" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.trackers.map((tr) => (
                        <button
                          key={tr.jobId}
                          onClick={() => {
                            setSource({ type: "tracker", id: tr.jobId, jobId: tr.jobId });
                            setTitle(`Job ${tr.jobNo}`);
                            if (tr.description) setBody(tr.description);
                            setLinkUrl(tr.trackerUrl);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === tr.jobId ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Job {tr.jobNo} {tr.unitNo && ` • Unit ${tr.unitNo}`}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "summaries" && quickPicks.summaries.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No recent summaries available.</div>
                  )}
                  {template.quick === "summaries" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.summaries.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setSource({ type: "summary", id: s.id });
                            setTitle(s.title);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === s.id ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">{s.title}</div>
                          <div className="text-xs text-muted-foreground">{s.serviceDate} • {s.status}</div>
                        </button>
                      ))}
                    </div>
                  )}

                  {template.quick === "photos" && quickPicks.photoJobs.length === 0 && (
                    <div className="text-sm text-muted-foreground italic">No recent photos.</div>
                  )}
                  {template.quick === "photos" && (
                    <div className="flex flex-wrap gap-2">
                      {quickPicks.photoJobs.map((p) => (
                        <button
                          key={p.jobId}
                          onClick={() => {
                            setSource({ type: "photos", id: p.jobId, jobId: p.jobId });
                            setTitle(`Photos: Job ${p.jobNo}`);
                            if (p.description) setBody(p.description);
                          }}
                          className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                            source?.id === p.jobId ? "bg-[#B4FF44]/20 border-[#B4FF44]" : "bg-card border-border hover:bg-muted"
                          }`}
                        >
                          <div className="text-sm font-bold">Job {p.jobNo} {p.unitNo && ` • Unit ${p.unitNo}`}</div>
                          <div className="text-xs text-muted-foreground">{p.photoCount} photos</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short and punchy"
                  className={inputCls}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={template.bodyPlaceholder ?? "Optional details..."}
                  rows={3}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {(template.money || amount !== "") && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-medium">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setSource(null);
                          setSourceIds([]);
                        }}
                        placeholder="0.00"
                        className={`${inputCls} pl-7`}
                      />
                    </div>
                  </div>
                )}
                {(template.due || template.money || dueDate !== "") && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Due date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Link {template.requireUrl ? "" : "(optional)"}
                </label>
                <div className="flex gap-2">
                  <input
                    value={linkLabel}
                    onChange={(e) => {
                      setLinkLabel(e.target.value);
                      if (template?.kind !== "document") {
                        setSource(null);
                        setSourceIds([]);
                      }
                    }}
                    placeholder="Label"
                    className={`${inputCls} max-w-[120px]`}
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      if (template?.kind !== "document") {
                        setSource(null);
                        setSourceIds([]);
                      }
                    }}
                    placeholder="https://"
                    className={inputCls}
                    required={template.requireUrl}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Attachments (PDF, documents, images)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((a, i) => (
                    <span
                      key={`${a.url}-${i}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-xl text-sm font-medium max-w-[240px]"
                      data-testid={`chip-attachment-${i}`}
                    >
                      <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{a.name}</span>
                      <button
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${a.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-dashed border-border bg-background text-sm font-bold cursor-pointer hover:bg-muted transition-colors">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {uploading ? "Uploading…" : "Attach file"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp,.txt"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        void uploadFiles(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="input-card-attachments"
                    />
                  </label>
                </div>
                <div className="text-xs text-muted-foreground">
                  Files open right from the card on the client's board.
                </div>
              </div>
            </div>
          )}
        </div>

        {template && (
          <div className="p-6 bg-card border-t border-border shrink-0 flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">
              Client will receive an instant email if notifications are on.
            </div>
            <button
              onClick={submit}
              disabled={
                push.isPending || 
                !title.trim() || 
                !targetId || 
                uploading ||
                (template.requireUrl ? !linkUrl.trim() && attachments.length === 0 : false) || 
                (template.multiSelect ? sourceIds.length === 0 : false)
              }
              className="px-6 py-2.5 bg-[#B4FF44] text-[#041029] text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {push.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Push to board
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

