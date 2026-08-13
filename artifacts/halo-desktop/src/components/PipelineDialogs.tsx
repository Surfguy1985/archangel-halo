import { useEffect, useMemo, useState} from "react";
import { useQueryClient} from "@tanstack/react-query";
import {
  useListProperties,
  useCreateLead,
  useUpdateLead,
  useListLeadEmailTemplates,
  useSendLeadEmail,
  useListLeadCampaignDefs,
  useStartLeadCampaign,
  useStopLeadCampaign,
  useGetBusinessSettings,
  useCreateBid,
  useGetBid,
  useUpdateBid,
  useDeleteBid,
  useDeleteLead,
  useSendBid,
  getListLeadsQueryKey,
  getListBidsQueryKey,
  getGetBidQueryKey,
  getGetTodayQueryKey,
  getGetQueuesQueryKey,
} from "@workspace/api-client-react";
import { useToast} from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button} from "@/components/ui/button";
import { Label} from "@/components/ui/label";
import { Input} from "@/components/ui/input";
import { Textarea} from "@/components/ui/textarea";
import { Badge} from "@/components/ui/badge";
import { format} from "date-fns";
import {
  Plus,
  Trash2,
  Send,
  FileText,
  Mail,
  Zap,
  StopCircle,
  Pencil,
  Phone,
} from "lucide-react";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD"});

const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "dead"];
const NONE = "__none__";

// ---------------------------------------------------------------------------
// Add Lead
// ---------------------------------------------------------------------------

export function AddLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: properties} = useListProperties();
  const createLead = useCreateLead();

  const [propertyId, setPropertyId] = useState(NONE);
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  useEffect(() => {
    if (open) {
      setPropertyId(NONE);
      setSource("");
      setSummary("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
   }
 }, [open]);

  const submit = () => {
    if (!summary.trim()) {
      toast({ title: "Summary is required", variant: "destructive"});
      return;
   }
    createLead.mutate(
      {
        data: {
          propertyId: propertyId === NONE ? undefined : propertyId,
          source: source.trim() || undefined,
          summary: summary.trim(),
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
       },
     },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey()});
          onOpenChange(false);
          toast({ title: "Lead added"});
       },
        onError: (e) =>
          toast({ title: "Couldn't add lead", description: e.message, variant: "destructive"}),
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">New Lead</DialogTitle>
          <DialogDescription>
            Capture a new opportunity. Add a contact email to enable one-click
            follow-ups and drip campaigns.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Property (optional)</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger data-testid="select-lead-property">
                <SelectValue placeholder="No property" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No property</SelectItem>
                {properties?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Summary</Label>
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What is this lead about?"
              data-testid="input-lead-summary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Contact name</Label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Jane Smith"
                data-testid="input-lead-contact-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact email</Label>
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="jane@example.com"
                data-testid="input-lead-contact-email"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Phone number</Label>
            <Input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="(555) 123-4567"
              data-testid="input-lead-contact-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Source (optional)</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Referral, inbound call, walk-in…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={createLead.isPending}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
            data-testid="button-save-lead"
          >
            {createLead.isPending ? "Saving…" : "Add lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lead detail: edit, one-click emails, campaigns
// ---------------------------------------------------------------------------

export interface LeadRow {
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
  campaignStepIndex?: number | null;
  campaignNextSendAt?: string | null;
  createdAt?: string | null;
}

export function LeadDetailDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();
  const sendEmail = useSendLeadEmail();
  const startCampaign = useStartLeadCampaign();
  const stopCampaign = useStopLeadCampaign();
  const { data: bizSettings } = useGetBusinessSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const doDeleteLead = () => {
    if (!lead) return;
    deleteLead.mutate(
      { id: lead.id},
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey()});
          queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
          toast({ title: "Lead deleted"});
          onOpenChange(false);
       },
        onError: (e) =>
          toast({ title: "Couldn't delete", description: e.message, variant: "destructive"}),
     },
    );
 };
  const { data: templates} = useListLeadEmailTemplates(lead?.id ?? "", {
    query: {
      queryKey: ["leadTemplates", lead?.id ?? ""],
      enabled: open && !!lead,
   },
 });
  const { data: campaignDefs} = useListLeadCampaignDefs();

  const [status, setStatus] = useState("new");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (open && lead) {
      setStatus(lead.status);
      setContactName(lead.contactName ?? "");
      setContactEmail(lead.contactEmail ?? "");
      setContactPhone(lead.contactPhone ?? "");
      setSelectedTemplate(null);
      setShowTranscript(false);
      setConfirmDelete(false);
   }
 }, [open, lead]);

  if (!lead) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey()});
    queryClient.invalidateQueries({ queryKey: ["leadTemplates", lead.id]});
 };

  const dirty =
    status !== lead.status ||
    contactName !== (lead.contactName ?? "") ||
    contactEmail !== (lead.contactEmail ?? "") ||
    contactPhone !== (lead.contactPhone ?? "");

  const saveDetails = () => {
    updateLead.mutate(
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
          toast({ title: "Lead updated"});
       },
        onError: (e) =>
          toast({ title: "Couldn't update", description: e.message, variant: "destructive"}),
     },
    );
 };

  const hasRecipient = !!(contactEmail.trim() || lead.contactEmail || lead.propertyId);
  const activeCampaign = lead.campaignStatus === "active";
  const dripEnabled = bizSettings?.emailLeadNurtureDrip ?? false;
  const tpl = templates?.find((t) => t.key === selectedTemplate);

  const doSendEmail = (templateKey: string) => {
    sendEmail.mutate(
      { id: lead.id, data: { templateKey}},
      {
        onSuccess: (res) => {
          if (res.sent) {
            invalidate();
            toast({ title: "Email sent", description:`Sent to ${res.to}.`});
            setSelectedTemplate(null);
         } else {
            toast({ title: "Couldn't send", description: res.error ?? "Send failed", variant: "destructive"});
         }
       },
        onError: (e) =>
          toast({ title: "Couldn't send", description: e.message, variant: "destructive"}),
     },
    );
 };

  const doStartCampaign = (kind: string) => {
    startCampaign.mutate(
      { id: lead.id, data: { kind } },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Campaign started",
            description: "The first email just went out. The rest are scheduled automatically.",
          });
        },
        onError: (e) =>
          toast({ title: "Couldn't start campaign", description: e.message, variant: "destructive" }),
      },
    );
  };

  const doStopCampaign = () => {
    stopCampaign.mutate(
      { id: lead.id},
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Campaign stopped"});
       },
        onError: (e) =>
          toast({ title: "Couldn't stop campaign", description: e.message, variant: "destructive"}),
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            {lead.propertyName || "Lead"}
            {lead.source === "phone" && (
              <span className="text-[10px] font-bold text-[var(--gold-dark)] px-2 py-0.5 rounded-full bg-[var(--gold-tint)] border border-[var(--gold)]/20 inline-flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" /> phone call
              </span>
            )}
          </DialogTitle>
          <DialogDescription>{lead.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-lead-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contact name</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact email</Label>
              <Input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                data-testid="input-detail-contact-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact phone</Label>
              <Input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                data-testid="input-detail-contact-phone"
              />
            </div>
          </div>
          {lead.callTranscript && (
            <div className="border border-border rounded-lg bg-[var(--paper)]">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium"
                onClick={() => setShowTranscript((v) => !v)}
                data-testid="button-toggle-transcript"
              >
                <span className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-[var(--gold-dark)]" /> Call transcript
                </span>
                <span className="text-xs text-muted-foreground">{showTranscript ? "Hide" : "Show"}</span>
              </button>
              {showTranscript && (
                <p className="px-4 pb-4 text-sm text-muted-foreground whitespace-pre-line max-h-64 overflow-y-auto">
                  {lead.callTranscript}
                </p>
              )}
            </div>
          )}
          {dirty && (
            <Button
              size="sm"
              onClick={saveDetails}
              disabled={updateLead.isPending}
              className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
              data-testid="button-save-lead-details"
            >
              {updateLead.isPending ? "Saving…" : "Save changes"}
            </Button>
          )}
          {lead.lastContactAt && (
            <p className="text-xs text-muted-foreground">
              Last contacted {format(new Date(lead.lastContactAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          )}

          {/* One-click follow-ups */}
          <div className="border border-border rounded-lg p-4 space-y-3 bg-[var(--paper)]">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Mail className="w-4 h-4 text-[var(--gold-dark)]" /> One-click follow-up
            </h3>
            {!hasRecipient ? (
              <p className="text-xs text-muted-foreground">
                Add a contact email above (or link a property with a contact) to send follow-ups.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {templates?.map((t) => (
                  <Button
                    key={t.key}
                    size="sm"
                    variant={selectedTemplate === t.key ? "default" : "outline"}
                    onClick={() => setSelectedTemplate(selectedTemplate === t.key ? null : t.key)}
                    data-testid={`button-template-${t.key}`}
                  >
                    {t.name}
                  </Button>
                ))}
              </div>
            )}
            {tpl && (
              <div className="bg-white border border-border rounded-md p-3 space-y-2">
                <p className="text-xs font-semibold">{tpl.subject}</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line max-h-40 overflow-y-auto">
                  {tpl.body}
                </p>
                <Button
                  size="sm"
                  onClick={() => doSendEmail(tpl.key)}
                  disabled={sendEmail.isPending || dirty}
                  className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
                  data-testid="button-send-lead-email"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  {sendEmail.isPending ? "Sending…" : "Send this email"}
                </Button>
                {dirty && (
                  <p className="text-xs text-muted-foreground">Save your changes first so the email uses the latest contact info.</p>
                )}
              </div>
            )}
          </div>

          {/* Drip campaigns */}
          <div className="border border-border rounded-lg p-4 space-y-3 bg-[var(--paper)]">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--gold-dark)]" /> Drip campaign
            </h3>
            {activeCampaign ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge className="bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]/30" variant="outline">
                    {campaignDefs?.find((c) => c.kind === lead.campaignKind)?.name ?? lead.campaignKind} — active
                  </Badge>
                  {lead.campaignNextSendAt && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Next email {format(new Date(lead.campaignNextSendAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={doStopCampaign}
                  disabled={stopCampaign.isPending}
                  data-testid="button-stop-campaign"
                >
                  <StopCircle className="w-3.5 h-3.5 mr-1.5" /> Stop
                </Button>
              </div>
            ) : !hasRecipient ? (
              <p className="text-xs text-muted-foreground">
                Add a contact email to send a one-off template email to this lead.
              </p>
            ) : dripEnabled ? (
              <div className="space-y-2">
                {campaignDefs?.map((c) => (
                  <div
                    key={c.kind}
                    className="flex items-center justify-between gap-3 bg-white border border-border rounded-md p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => doStartCampaign(c.kind)}
                      disabled={startCampaign.isPending}
                      className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black shrink-0"
                      data-testid={`button-start-campaign-${c.kind}`}
                    >
                      Start
                    </Button>
                  </div>
                ))}
                {lead.campaignStatus === "completed" && (
                  <p className="text-xs text-muted-foreground">Previous campaign completed.</p>
                )}
                {lead.campaignStatus === "stopped" && (
                  <p className="text-xs text-muted-foreground">Previous campaign was stopped.</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Drip campaigns are currently turned off. Use a one-off template email above to reach out.
                </p>
                {lead.campaignStatus === "completed" && (
                  <p className="text-xs text-muted-foreground">Previous campaign completed.</p>
                )}
                {lead.campaignStatus === "stopped" && (
                  <p className="text-xs text-muted-foreground">Previous campaign was stopped.</p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-1">
            {confirmDelete ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={doDeleteLead}
                disabled={deleteLead.isPending}
                data-testid="button-confirm-delete-lead"
              >
                {deleteLead.isPending ? "Deleting…" : "Confirm delete"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setConfirmDelete(true)}
                data-testid="button-delete-lead"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete lead
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bid builder (create + edit)
// ---------------------------------------------------------------------------

interface LineItemDraft {
  service: string;
  description: string;
  qty: string;
  unitPrice: string;
}

const emptyItem = (): LineItemDraft => ({
  service: "",
  description: "",
  qty: "1",
  unitPrice: "",
});

export function BidBuilderDialog({
  open,
  onOpenChange,
  editBidId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editBidId?: string | null;
  onSaved?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: properties} = useListProperties();
  const createBid = useCreateBid();
  const updateBid = useUpdateBid();
  const { data: editing} = useGetBid(editBidId ?? "", {
    query: {
      queryKey: getGetBidQueryKey(editBidId ?? ""),
      enabled: open && !!editBidId,
   },
 });

  const [propertyId, setPropertyId] = useState(NONE);
  const [unitNo, setUnitNo] = useState("");
  const [scope, setScope] = useState("");
  const [welcome, setWelcome] = useState("");
  const [estCost, setEstCost] = useState("");
  const [items, setItems] = useState<LineItemDraft[]>([emptyItem()]);

  useEffect(() => {
    if (!open) return;
    if (editBidId && editing) {
      setPropertyId(editing.propertyId ?? NONE);
      setUnitNo(editing.unitNo ?? "");
      setScope(editing.scope ?? "");
      setWelcome(editing.welcomeMessage ?? "");
      setEstCost(editing.estCost != null ? String(editing.estCost) : "");
      setItems(
        editing.lineItems?.length
          ? editing.lineItems.map((it) => ({
              service: it.service,
              description: it.description ?? "",
              qty: String(it.qty),
              unitPrice: String(it.unitPrice),
           }))
          : [emptyItem()],
      );
   } else if (!editBidId) {
      setPropertyId(NONE);
      setUnitNo("");
      setScope("");
      setWelcome("");
      setEstCost("");
      setItems([emptyItem()]);
   }
 }, [open, editBidId, editing]);

  const parsedItems = useMemo(
    () =>
      items
        .filter((it) => it.service.trim())
        .map((it) => ({
          service: it.service.trim(),
          description: it.description.trim() || undefined,
          qty: Math.max(0, Number(it.qty) || 0),
          unitPrice: Math.max(0, Number(it.unitPrice) || 0),
       })),
    [items],
  );
  const total = useMemo(
    () => parsedItems.reduce((s, it) => s + it.qty * it.unitPrice, 0),
    [parsedItems],
  );

  const setItem = (idx: number, patch: Partial<LineItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch} : it)));
 };

  const invalidate = (id: string) => {
    queryClient.invalidateQueries({ queryKey: getListBidsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetBidQueryKey(id)});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey()});
 };

  const submit = () => {
    if (!scope.trim()) {
      toast({ title: "Scope is required", variant: "destructive"});
      return;
   }
    if (!parsedItems.length) {
      toast({ title: "Add at least one line item", variant: "destructive"});
      return;
   }
    const payload = {
      propertyId: propertyId === NONE ? undefined : propertyId,
      unitNo: unitNo.trim() || undefined,
      scope: scope.trim(),
      welcomeMessage: welcome.trim() || undefined,
      estCost: estCost.trim() ? Number(estCost) : undefined,
      lineItems: parsedItems,
   };
    if (editBidId) {
      updateBid.mutate(
        { id: editBidId, data: payload},
        {
          onSuccess: (res) => {
            invalidate(editBidId);
            onOpenChange(false);
            toast({ title:`Bid ${res.bidNo} updated`});
            onSaved?.(editBidId);
         },
          onError: (e) =>
            toast({ title: "Couldn't save bid", description: e.message, variant: "destructive"}),
       },
      );
   } else {
      createBid.mutate(
        { data: { ...payload, amount: total, status: "draft"}},
        {
          onSuccess: (res) => {
            invalidate(res.id);
            onOpenChange(false);
            toast({
              title:`Bid ${res.bidNo} created`,
              description: "Saved as a draft. Open it to preview the proposal PDF and send it.",
           });
            onSaved?.(res.id);
         },
          onError: (e) =>
            toast({ title: "Couldn't create bid", description: e.message, variant: "destructive"}),
       },
      );
   }
 };

  const pending = createBid.isPending || updateBid.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto border-none shadow-xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editBidId ? "Edit Bid" : "New Bid"}
          </DialogTitle>
          <DialogDescription>
            Build a line-item proposal. Company payment and remittance details
            are pulled from Business Info automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Property</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger data-testid="select-bid-property">
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No property</SelectItem>
                  {properties?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit #</Label>
              <Input value={unitNo} onChange={(e) => setUnitNo(e.target.value)} placeholder="215" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Scope of work</Label>
            <Textarea
              rows={2}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="Full unit turn: paint, drywall repair, deep clean…"
              data-testid="input-bid-scope"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Welcome message (appears on the proposal)</Label>
            <Textarea
              rows={2}
              value={welcome}
              onChange={(e) => setWelcome(e.target.value)}
              placeholder="Thank you for the opportunity to earn your business…"
              data-testid="input-bid-welcome"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setItems((p) => [...p, emptyItem()])}
                data-testid="button-add-line-item"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add item
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_90px_110px_100px_32px] gap-2 items-start">
                  <div className="space-y-1">
                    <Input
                      value={it.service}
                      onChange={(e) => setItem(idx, { service: e.target.value})}
                      placeholder="Service (e.g. Full interior paint)"
                      data-testid={`input-item-service-${idx}`}
                    />
                    <Input
                      value={it.description}
                      onChange={(e) => setItem(idx, { description: e.target.value})}
                      placeholder="Description (optional)"
                      className="text-xs"
                    />
                  </div>
                  <Input
                    type="number"
                    min="0"
                    value={it.qty}
                    onChange={(e) => setItem(idx, { qty: e.target.value})}
                    placeholder="Qty"
                    data-testid={`input-item-qty-${idx}`}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.unitPrice}
                    onChange={(e) => setItem(idx, { unitPrice: e.target.value})}
                    placeholder="Unit price"
                    data-testid={`input-item-price-${idx}`}
                  />
                  <div className="h-9 flex items-center justify-end font-mono text-sm font-medium">
                    {money((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setItems((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p))}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center border-t border-border pt-2">
              <div className="space-y-1.5 w-40">
                <Label className="text-xs text-muted-foreground">Est. internal cost (optional)</Label>
                <Input
                  type="number"
                  min="0"
                  value={estCost}
                  onChange={(e) => setEstCost(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-bid-est-cost"
                />
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground font-bold">Proposal total</p>
                <p className="font-mono font-bold text-xl text-[var(--gold-dark)]" data-testid="text-bid-total">
                  {money(total)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={pending}
            className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
            data-testid="button-save-bid"
          >
            {pending ? "Saving…" : editBidId ? "Save changes" : "Create bid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bid detail: PDF preview, send, status, delete
// ---------------------------------------------------------------------------

export function BidDetailDialog({
  open,
  onOpenChange,
  bidId,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidId: string | null;
  onEdit: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast} = useToast();
  const { data: bid} = useGetBid(bidId ?? "", {
    query: {
      queryKey: getGetBidQueryKey(bidId ?? ""),
      enabled: open && !!bidId,
   },
 });
  const updateBid = useUpdateBid();
  const deleteBid = useDeleteBid();
  const sendBid = useSendBid();

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open && bid) {
      setSendTo(bid.contactEmail ?? "");
      setSendMessage("");
      setSendOpen(false);
      setConfirmDelete(false);
   }
 }, [open, bid?.id]);

  if (!bidId) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListBidsQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetBidQueryKey(bidId)});
    queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey()});
    queryClient.invalidateQueries({ queryKey: getGetQueuesQueryKey()});
 };

  const setStatus = (status: string) => {
    updateBid.mutate(
      { id: bidId, data: { status}},
      {
        onSuccess: () => {
          invalidate();
          toast({ title:`Bid marked ${status}`});
       },
        onError: (e) =>
          toast({ title: "Couldn't update", description: e.message, variant: "destructive"}),
     },
    );
 };

  const doDelete = () => {
    deleteBid.mutate(
      { id: bidId},
      {
        onSuccess: () => {
          invalidate();
          onOpenChange(false);
          toast({ title: "Bid deleted"});
       },
        onError: (e) =>
          toast({ title: "Couldn't delete", description: e.message, variant: "destructive"}),
     },
    );
 };

  const doSend = () => {
    sendBid.mutate(
      {
        id: bidId,
        data: {
          to: sendTo.trim() || undefined,
          message: sendMessage.trim() || undefined,
       },
     },
      {
        onSuccess: (res) => {
          if (res.sent) {
            invalidate();
            setSendOpen(false);
            toast({ title: "Proposal sent", description:`Emailed to ${res.to} with the PDF attached.`});
         } else {
            toast({ title: "Couldn't send", description: res.error ?? "Send failed", variant: "destructive"});
         }
       },
        onError: (e) =>
          toast({ title: "Couldn't send", description: e.message, variant: "destructive"}),
     },
    );
 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-none shadow-xl">
        {!bid ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-3">
                {bid.bidNo}
                <Badge
                  variant="outline"
                  className={
                    bid.status === "won"
                      ? "bg-[var(--green)]/10 text-[var(--green)] border-[var(--green)]/20"
                      : bid.status === "lost"
                        ? "bg-destructive/10 text-destructive border-destructive/20"
                        : "bg-[var(--gold-tint)] text-[var(--gold-dark)] border-[var(--gold)]/20"
                 }
                >
                  {bid.status}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {bid.propertyName || "No property"}
                {bid.unitNo ?` · Unit ${bid.unitNo}` : ""}
                {bid.contactName ?` · ${bid.contactName}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {bid.scope && (
                <p className="text-sm text-muted-foreground">{bid.scope}</p>
              )}
              {bid.welcomeMessage && (
                <div className="bg-[var(--gold-tint)] border border-[var(--gold)]/20 rounded-md p-3">
                  <p className="text-[10px] font-bold text-[var(--gold-dark)] mb-1">
                    Welcome message
                  </p>
                  <p className="text-sm">{bid.welcomeMessage}</p>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--paper)] text-left">
                      <th className="px-3 py-2 font-semibold">Service</th>
                      <th className="px-3 py-2 font-semibold text-right w-14">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right w-24">Unit</th>
                      <th className="px-3 py-2 font-semibold text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bid.lineItems?.length ? (
                      bid.lineItems.map((it) => (
                        <tr key={it.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <p className="font-medium">{it.service}</p>
                            {it.description && (
                              <p className="text-xs text-muted-foreground">{it.description}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{it.qty}</td>
                          <td className="px-3 py-2 text-right font-mono">{money(it.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium">{money(it.amount)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground" colSpan={4}>
                          No line items — the proposal shows the total only.
                        </td>
                      </tr>
                    )}
                    <tr className="border-t-2 border-border bg-[var(--paper)]">
                      <td className="px-3 py-2 font-bold" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-[var(--gold-dark)]">
                        {money(bid.amount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" data-testid="button-view-pdf">
                  <a href={`/api/bids/${bid.id}/pdf`} target="_blank" rel="noreferrer">
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> View PDF
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => onEdit(bid.id)} data-testid="button-edit-bid">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
                {bid.status !== "won" && (
                  <Button size="sm" variant="outline" onClick={() => setStatus("won")} disabled={updateBid.isPending}>
                    Mark won
                  </Button>
                )}
                {bid.status !== "lost" && (
                  <Button size="sm" variant="outline" onClick={() => setStatus("lost")} disabled={updateBid.isPending}>
                    Mark lost
                  </Button>
                )}
                {confirmDelete ? (
                  <Button size="sm" variant="destructive" onClick={doDelete} disabled={deleteBid.isPending} data-testid="button-confirm-delete-bid">
                    {deleteBid.isPending ? "Deleting…" : "Confirm delete"}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} data-testid="button-delete-bid">
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setSendOpen((v) => !v)}
                  className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black ml-auto"
                  data-testid="button-open-send-bid"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" /> Send proposal
                </Button>
              </div>

              {sendOpen && (
                <div className="border border-border rounded-lg p-4 space-y-3 bg-[var(--paper)]">
                  <div className="space-y-1.5">
                    <Label>Send to</Label>
                    <Input
                      type="email"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                      placeholder={bid.contactEmail ?? "recipient@example.com"}
                      data-testid="input-send-bid-to"
                    />
                    {bid.contactEmail && !sendTo && (
                      <p className="text-xs text-muted-foreground">
                        Defaults to {bid.contactName ?? "the property contact"} ({bid.contactEmail}).
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Custom message (optional)</Label>
                    <Textarea
                      rows={3}
                      value={sendMessage}
                      onChange={(e) => setSendMessage(e.target.value)}
                      placeholder="Leave blank for a professional default message."
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={doSend}
                    disabled={sendBid.isPending || (!sendTo.trim() && !bid.contactEmail)}
                    className="bg-[var(--gold-light)] hover:bg-[var(--gold-dark)] text-black"
                    data-testid="button-send-bid"
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {sendBid.isPending ? "Sending…" : "Send with PDF attached"}
                  </Button>
                  {!sendTo.trim() && !bid.contactEmail && (
                    <p className="text-xs text-destructive">
                      No property contact email on file — enter a recipient above.
                    </p>
                  )}
                </div>
              )}

              {bid.sentAt && (
                <p className="text-xs text-muted-foreground">
                  Sent {format(new Date(bid.sentAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
