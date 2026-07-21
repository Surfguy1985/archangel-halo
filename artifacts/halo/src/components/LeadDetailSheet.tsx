import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Phone, Send, StopCircle, Zap } from "lucide-react";
import {
  useUpdateLead,
  useListLeadEmailTemplates,
  useSendLeadEmail,
  useListLeadCampaignDefs,
  useStartLeadCampaign,
  useStopLeadCampaign,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";

const fieldCls =
  "w-full bg-card border border-border rounded-[13px] py-[11px] px-[14px] text-[14.5px] shadow-[var(--shadow)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--gold)]";

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "dead"];

export interface MobileLeadRow {
  id: string;
  propertyId?: string | null;
  propertyName?: string | null;
  source?: string | null;
  summary?: string | null;
  status: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  callTranscript?: string | null;
  lastContactAt?: string | null;
  campaignKind?: string | null;
  campaignStatus?: string | null;
  campaignNextSendAt?: string | null;
}

export function LeadDetailSheet({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: MobileLeadRow | null;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateLead();
  const sendEmail = useSendLeadEmail();
  const startCampaign = useStartLeadCampaign();
  const stopCampaign = useStopLeadCampaign();
  const { data: templates } = useListLeadEmailTemplates(lead?.id ?? "", {
    query: {
      queryKey: ["leadTemplates", lead?.id ?? ""],
      enabled: open && !!lead,
    },
  });
  const { data: campaignDefs } = useListLeadCampaignDefs();

  const [status, setStatus] = useState("new");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (open && lead) {
      setStatus(lead.status);
      setContactName(lead.contactName ?? "");
      setContactEmail(lead.contactEmail ?? "");
      setContactPhone(lead.contactPhone ?? "");
      setSelectedTemplate(null);
      setFeedback(null);
      setShowTranscript(false);
    }
  }, [open, lead?.id]);

  if (!lead) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["leadTemplates", lead.id] });
  };

  const dirty =
    status !== lead.status ||
    contactName !== (lead.contactName ?? "") ||
    contactEmail !== (lead.contactEmail ?? "") ||
    contactPhone !== (lead.contactPhone ?? "");

  const saveDetails = () => {
    update.mutate(
      {
        id: lead.id,
        data: {
          status,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setFeedback("Lead updated.");
        },
        onError: () => setFeedback("Couldn't save. Try again."),
      },
    );
  };

  const hasRecipient = !!(contactEmail.trim() || lead.contactEmail || lead.propertyId);
  const activeCampaign = lead.campaignStatus === "active";
  const tpl = templates?.find((t) => t.key === selectedTemplate);

  const btnGold =
    "w-full rounded-[11px] py-[10px] text-[13px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_14px_rgba(143,106,31,0.3)] disabled:opacity-50 transition-transform active:scale-[0.98]";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[26px] bg-[var(--paper)] p-0 flex flex-col max-h-[88vh] border-none shadow-[0_-12px_44px_rgba(23,24,28,0.24)]"
      >
        <div className="w-[40px] h-[4.5px] rounded-[3px] bg-[rgba(23,24,28,0.16)] mx-auto mt-[10px] mb-[4px] shrink-0" />
        <div className="p-[8px_20px_26px] overflow-y-auto">
          <SheetHeader className="text-left mb-[12px]">
            <SheetTitle className="font-display font-bold text-[19px] m-[6px_0_2px] flex items-center gap-[8px]">
              {lead.propertyName || lead.contactName || "Lead"}
              {lead.source === "phone" && (
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] px-[7px] py-[2px] rounded-full bg-[rgba(143,106,31,0.12)] text-[var(--gold-dark)] inline-flex items-center gap-[3px]">
                  <Phone className="w-[10px] h-[10px]" /> call
                </span>
              )}
            </SheetTitle>
            {lead.summary && (
              <div className="text-[13px] text-muted-foreground">{lead.summary}</div>
            )}
          </SheetHeader>

          <div className="flex flex-col gap-[10px] mb-[14px]">
            <select className={fieldCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex gap-[10px]">
              <input className={`${fieldCls} flex-1`} placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <input className={`${fieldCls} flex-1`} type="email" placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
            <input className={fieldCls} type="tel" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            {lead.callTranscript && (
              <div className="bg-card rounded-[16px] shadow-[var(--shadow)]">
                <button
                  className="w-full flex items-center justify-between px-[14px] py-[11px] text-[13px] font-display font-bold"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  <span className="flex items-center gap-[6px]">
                    <Phone className="w-[14px] h-[14px] text-[var(--gold-dark)]" /> Call transcript
                  </span>
                  <span className="text-[11.5px] text-muted-foreground font-normal">{showTranscript ? "Hide" : "Show"}</span>
                </button>
                {showTranscript && (
                  <div className="px-[14px] pb-[14px] text-[12.5px] text-muted-foreground whitespace-pre-line max-h-[200px] overflow-y-auto">
                    {lead.callTranscript}
                  </div>
                )}
              </div>
            )}
            {dirty && (
              <button className={btnGold} onClick={saveDetails} disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </button>
            )}
          </div>

          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px] mb-[12px]">
            <div className="flex items-center gap-[6px] font-display font-bold text-[14px] mb-[10px]">
              <Mail className="w-[15px] h-[15px] text-[var(--gold-dark)]" /> One-tap follow-up
            </div>
            {!hasRecipient ? (
              <div className="text-[12.5px] text-muted-foreground">
                Add a contact email above to send follow-ups.
              </div>
            ) : (
              <div className="flex flex-wrap gap-[6px]">
                {templates?.map((t) => (
                  <button
                    key={t.key}
                    className={`text-[12.5px] font-bold px-[10px] py-[6px] rounded-full border transition-colors ${
                      selectedTemplate === t.key
                        ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                        : "bg-[var(--paper)] border-border text-foreground"
                    }`}
                    onClick={() => setSelectedTemplate(selectedTemplate === t.key ? null : t.key)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {tpl && (
              <div className="mt-[10px] bg-[var(--paper)] border border-border rounded-[13px] p-[12px]">
                <div className="text-[12.5px] font-bold mb-[4px]">{tpl.subject}</div>
                <div className="text-[12px] text-muted-foreground whitespace-pre-line max-h-[140px] overflow-y-auto mb-[10px]">{tpl.body}</div>
                <button
                  className={btnGold}
                  disabled={sendEmail.isPending || dirty}
                  onClick={() =>
                    sendEmail.mutate(
                      { id: lead.id, data: { templateKey: tpl.key } },
                      {
                        onSuccess: (res) => {
                          if (res.sent) {
                            invalidate();
                            setSelectedTemplate(null);
                            setFeedback(`Email sent to ${res.to}.`);
                          } else {
                            setFeedback(res.error ?? "Couldn't send.");
                          }
                        },
                        onError: () => setFeedback("Couldn't send. Try again."),
                      },
                    )
                  }
                >
                  <span className="inline-flex items-center gap-[6px] justify-center">
                    <Send className="w-[14px] h-[14px]" />
                    {sendEmail.isPending ? "Sending…" : "Send this email"}
                  </span>
                </button>
                {dirty && (
                  <div className="text-[11.5px] text-muted-foreground mt-[6px]">Save changes first so the email uses the latest contact info.</div>
                )}
              </div>
            )}
          </div>

          <div className="bg-card rounded-[16px] shadow-[var(--shadow)] p-[14px]">
            <div className="flex items-center gap-[6px] font-display font-bold text-[14px] mb-[10px]">
              <Zap className="w-[15px] h-[15px] text-[var(--gold-dark)]" /> Drip campaign
            </div>
            {activeCampaign ? (
              <div className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[13px] font-semibold">
                    {campaignDefs?.find((c) => c.kind === lead.campaignKind)?.name ?? lead.campaignKind} — active
                  </div>
                  {lead.campaignNextSendAt && (
                    <div className="text-[12px] text-muted-foreground">
                      Next email {new Date(lead.campaignNextSendAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  )}
                </div>
                <button
                  className="shrink-0 flex items-center gap-[5px] text-[12.5px] font-bold px-[12px] py-[8px] rounded-[11px] bg-[var(--paper)] border border-border"
                  disabled={stopCampaign.isPending}
                  onClick={() =>
                    stopCampaign.mutate(
                      { id: lead.id },
                      {
                        onSuccess: () => {
                          invalidate();
                          setFeedback("Campaign stopped.");
                        },
                      },
                    )
                  }
                >
                  <StopCircle className="w-[13px] h-[13px]" /> Stop
                </button>
              </div>
            ) : !hasRecipient ? (
              <div className="text-[12.5px] text-muted-foreground">
                Add a contact email to start an automated sequence.
              </div>
            ) : (
              <div className="flex flex-col gap-[8px]">
                {campaignDefs?.map((c) => (
                  <div key={c.kind} className="flex items-center justify-between gap-[10px] bg-[var(--paper)] border border-border rounded-[13px] p-[11px]">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold">{c.name}</div>
                      <div className="text-[11.5px] text-muted-foreground">{c.description}</div>
                    </div>
                    <button
                      className="shrink-0 text-[12.5px] font-bold px-[14px] py-[8px] rounded-[11px] text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] disabled:opacity-50"
                      disabled={startCampaign.isPending}
                      onClick={() =>
                        startCampaign.mutate(
                          { id: lead.id, data: { kind: c.kind } },
                          {
                            onSuccess: () => {
                              invalidate();
                              setFeedback("Campaign started — the first email just went out.");
                            },
                            onError: () => setFeedback("Couldn't start campaign."),
                          },
                        )
                      }
                    >
                      Start
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {feedback && (
            <div className="text-[12.5px] text-center mt-[12px] text-muted-foreground">{feedback}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
