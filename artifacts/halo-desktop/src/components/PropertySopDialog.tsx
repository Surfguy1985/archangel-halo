import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPropertySopRule,
  useUploadPropertySopDocument,
  useDeletePropertySopRule,
  getGetPropertySopRuleQueryKey,
} from "@workspace/api-client-react";
import { FileText, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { prepareScanImage } from "@/lib/scanImage";
import { RuleSheet, SOP_ACCEPT, sopFileToBase64 } from "@/components/InvoiceWizardDialog";

/**
 * Per-property SOP billing guideline manager, opened from the settings wheel
 * on each property row. Upload / view / replace / remove the SOP rule that
 * every invoice for the property must follow (enforced server-side).
 */
export function PropertySopDialog({
  propertyId,
  propertyName,
  open,
  onOpenChange,
}: {
  propertyId: string;
  propertyName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
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
    const isCsv = file.type === "text/csv" || /\.csv$/i.test(file.name);
    const isTxt = !isCsv && (file.type === "text/plain" || /\.txt$/i.test(file.name));
    if (!isPdf && !isImg && !isCsv && !isTxt) {
      toast({ title: "Upload a PDF, CSV, or image (PNG/JPG) of the SOP", variant: "destructive" });
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast({ title: "File is over 6 MB — export a smaller PDF or a page image", variant: "destructive" });
      return;
    }
    try {
      let data: string;
      let mediaType: string;
      if (isPdf || isCsv || isTxt) {
        data = await sopFileToBase64(file);
        mediaType = isPdf ? "application/pdf" : isCsv ? "text/csv" : "text/plain";
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
            SOP invoice guidelines
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Upload {propertyName}'s SOP or billing guideline. A fixed rule is
          extracted, and every invoice for this property must follow it.
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
            data-testid="button-property-sop-upload-zone"
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
            <div className="font-bold mt-3">Drop in the SOP guideline document</div>
            <div className="text-sm text-muted-foreground mt-1">
              PDF, CSV, or image (PNG/JPG), up to 6 MB
            </div>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={SOP_ACCEPT}
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
              data-testid="button-property-sop-replace"
            >
              <Upload className="w-4 h-4 mr-2" /> Replace document
            </Button>
            <Button
              variant="outline"
              className="rounded-full font-bold"
              onClick={() => window.open(`/api/properties/${propertyId}/sop-rule/source`, "_blank")}
              data-testid="button-property-sop-source"
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
              data-testid="button-property-sop-delete"
            >
              {remove.isPending ? "Removing…" : confirmingDelete ? "Really remove?" : "Remove rule"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
