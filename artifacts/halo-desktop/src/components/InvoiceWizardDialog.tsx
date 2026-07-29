import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPropertySopRule,
  useUploadPropertySopDocument,
  useDeletePropertySopRule,
  getGetPropertySopRuleQueryKey,
  type SopRuleDetail,
} from "@workspace/api-client-react";
import { FileText, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function RuleSheet({ rule }: { rule: SopRuleDetail }) {
  const r = rule.rules;
  const f = r.format ?? {};
  const p = r.property ?? {};
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <div>
        <div className="text-[11px] font-bold text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground mt-0.5">{value}</div>
      </div>
    ) : null;
  const formatLine = [
    f.invoice_number_format && `Invoice # ${f.invoice_number_format}`,
    f.date_format,
    f.currency,
    f.tax_rate_percent != null && f.tax_rate_percent > 0 && `Tax ${f.tax_rate_percent}%`,
    f.due_days != null && `Due in ${f.due_days} days`,
    f.po_required && "PO required",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-[var(--ink)] text-white p-4">
        <ShieldCheck className="w-5 h-5 text-[var(--gold-light,#B4FF44)] shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">Rule is live</div>
          <div className="text-sm text-white/70 mt-0.5">
            Every invoice created for this property — from any job or invoice
            button — follows this rule automatically.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {row(
          "Property / aliases",
          [p.name, ...(p.aliases ?? [])].filter(Boolean).join(" · "),
        )}
        {row("Bill to", [p.client_company, p.billing_address].filter(Boolean).join(" — "))}
        {row("Format", formatLine)}
        {row("Payment terms", f.payment_terms)}
        {row("Remit to", f.remit_to)}
        {row(
          "Delivery",
          [f.delivery_method, f.send_to].filter(Boolean).join(" · "),
        )}
      </div>
      {(r.required_fields?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Required on every invoice</div>
          <div className="text-sm mt-0.5">{(r.required_fields ?? []).join(", ")}</div>
        </div>
      )}
      {(r.line_item_rules?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Line item rules</div>
          <div className="space-y-1 mt-1">
            {(r.line_item_rules ?? []).map((l, i) => (
              <div key={i} className="text-sm">
                • <span className="font-semibold">{l.category || "General"}</span>
                {l.description_rule ? ` — ${l.description_rule}` : ""}
                {l.default_rate != null ? ` (${l.rate_type || "flat"} $${l.default_rate})` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
      {(r.special_instructions?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-bold text-muted-foreground">Special instructions</div>
          <div className="space-y-1 mt-1">
            {(r.special_instructions ?? []).map((s, i) => (
              <div key={i} className="text-sm">• {s}</div>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Extracted from <span className="font-semibold">{rule.fileName}</span> ·
        updated {new Date(rule.updatedAt).toLocaleDateString()}
      </div>
    </div>
  );
}

export function InvoiceWizardDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { data: rule, isLoading } = useGetPropertySopRule(propertyId, {
    query: {
      enabled: open && !!propertyId,
      queryKey: getGetPropertySopRuleQueryKey(propertyId),
      retry: false,
    },
  });
  const upload = useUploadPropertySopDocument();
  const remove = useDeletePropertySopRule();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getGetPropertySopRuleQueryKey(propertyId),
    });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImg = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
    if (!isPdf && !isImg) {
      toast({ title: "Upload a PDF or an image (PNG/JPG) of the SOP", variant: "destructive" });
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast({ title: "File is over 6 MB — export a smaller PDF or a page image", variant: "destructive" });
      return;
    }
    try {
      let data: string;
      let mediaType: string;
      if (isPdf) {
        data = await fileToBase64(file);
        mediaType = "application/pdf";
      } else {
        const prepared = await prepareScanImage(file);
        data = prepared.base64;
        mediaType = prepared.mediaType;
      }
      upload.mutate(
        {
          id: propertyId,
          data: {
            fileName: file.name,
            mediaType: mediaType as "application/pdf",
            data,
          },
        },
        {
          onSuccess: (detail) => {
            invalidate();
            toast({
              title: `Rule created for ${detail.rules.property?.name || propertyName}`,
              description: "All invoices for this property now follow it.",
            });
          },
          onError: (err) =>
            toast({
              title: "Couldn't read the SOP",
              description: err.message,
              variant: "destructive",
            }),
        },
      );
    } catch {
      toast({ title: "Could not read the file", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-[var(--paper)] border-0 rounded-3xl p-8 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-[24px] text-[var(--ink)]">
            Invoice wizard
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Upload {propertyName}'s SOP or billing guideline. The wizard extracts
          a fixed rule, and every invoice for this property must follow it.
        </p>

        {isLoading && (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && upload.isPending && (
          <div className="rounded-2xl border-2 border-dashed border-border bg-white p-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--gold-dark,#5a7a00)]" />
            <div className="font-bold mt-3">Reading the SOP…</div>
            <div className="text-sm text-muted-foreground mt-1">
              Extracting the billing rule — this takes a few seconds.
            </div>
          </div>
        )}

        {!isLoading && !upload.isPending && rule && <RuleSheet rule={rule} />}

        {!isLoading && !upload.isPending && !rule && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-2xl border-2 border-dashed border-border bg-white p-10 text-center hover:border-[var(--ink)] transition-colors"
            data-testid="button-sop-upload-zone"
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
            <div className="font-bold mt-3">Drop in the SOP guideline document</div>
            <div className="text-sm text-muted-foreground mt-1">
              PDF or image (PNG/JPG), up to 6 MB
            </div>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {rule && !upload.isPending && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-[var(--gold-light,#B4FF44)] text-black font-bold hover:opacity-90"
              data-testid="button-sop-replace"
            >
              <Upload className="w-4 h-4 mr-2" /> Replace document
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold"
              onClick={() => window.open(`/api/properties/${propertyId}/sop-rule/source`, "_blank")}
              data-testid="button-sop-source"
            >
              <FileText className="w-4 h-4 mr-2" /> Source doc
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold text-destructive border-destructive/40 hover:bg-destructive/5 ml-auto"
              disabled={remove.isPending}
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                remove.mutate(
                  { id: propertyId },
                  {
                    onSuccess: () => {
                      queryClient.removeQueries({
                        queryKey: getGetPropertySopRuleQueryKey(propertyId),
                      });
                      setConfirmingDelete(false);
                      toast({ title: "SOP rule removed" });
                    },
                    onError: (err) =>
                      toast({ title: "Couldn't remove the rule", description: err.message, variant: "destructive" }),
                  },
                );
              }}
              data-testid="button-sop-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {confirmingDelete ? "Confirm remove" : "Remove rule"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
