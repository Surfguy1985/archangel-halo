import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  FileText,
  Upload,
} from "lucide-react";
import {
  useGetOfficeClientHub,
  getGetOfficeClientHubQueryKey,
  useOfficeCreateHubItem,
  useOfficeUpdateHubItem,
  useOfficeDeleteHubItem,
  type HubItemRec,
  type HubItemInput,
} from "@workspace/api-client-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const inputCls =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";
const btnPrimary =
  "px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50";
const btnGhost =
  "px-4 py-2 text-sm font-bold rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50";

type SectionKey = "link" | "doc" | "card" | "employee" | "maintenance";

const SECTIONS: { key: SectionKey; label: string; blurb: string }[] = [
  { key: "link", label: "Quick Links", blurb: "Handy URLs for the client" },
  { key: "doc", label: "Documents", blurb: "Uploaded files or linked docs" },
  { key: "card", label: "Info Cards", blurb: "Free-form info blocks" },
  { key: "employee", label: "Client Team", blurb: "People on the account" },
  { key: "maintenance", label: "Maintenance contacts", blurb: "Who to call" },
];

// Absolute /api/... asset URLs must never be prefixed with BASE_URL.
async function requestUploadUrl(file: File): Promise<{ objectPath: string } | null> {
  try {
    const res = await fetch(`/api/storage/uploads/request-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name || "doc",
        size: Math.max(file.size, 1),
        contentType: file.type || "application/octet-stream",
      }),
    });
    if (!res.ok) return null;
    const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };
    const put = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    return put.ok ? { objectPath } : null;
  } catch {
    return null;
  }
}

type Draft = {
  title: string;
  subtitle: string;
  url: string;
  body: string;
  phone: string;
  email: string;
  storagePath: string | null;
};

const emptyDraft: Draft = {
  title: "",
  subtitle: "",
  url: "",
  body: "",
  phone: "",
  email: "",
  storagePath: null,
};

function ItemDialog({
  section,
  editing,
  onClose,
  onSave,
  saving,
}: {
  section: SectionKey;
  editing: HubItemRec | null;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          title: editing.title ?? "",
          subtitle: editing.subtitle ?? "",
          url: editing.url ?? "",
          body: editing.body ?? "",
          phone: editing.phone ?? "",
          email: editing.email ?? "",
          storagePath: null,
        }
      : { ...emptyDraft },
  );
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const pickFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await requestUploadUrl(file);
      if (!res) throw new Error("Upload failed");
      set({ storagePath: res.objectPath });
      setFileName(file.name);
      toast({ title: "File attached" });
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const label = SECTIONS.find((s) => s.key === section)?.label ?? section;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit" : "Add"} — {label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title</label>
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} data-testid="input-hub-title" />
          </div>

          {section === "employee" && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Role</label>
              <input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className={inputCls} placeholder="e.g. Property Manager" />
            </div>
          )}

          {(section === "employee" || section === "maintenance") && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Phone</label>
                <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</label>
                <input value={draft.email} onChange={(e) => set({ email: e.target.value })} className={inputCls} />
              </div>
            </div>
          )}

          {section === "maintenance" && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Note</label>
              <input value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className={inputCls} placeholder="e.g. 24/7 emergency line" />
            </div>
          )}

          {section === "card" && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Body</label>
              <textarea value={draft.body} onChange={(e) => set({ body: e.target.value })} rows={4} className={inputCls} />
            </div>
          )}

          {section === "link" && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">URL</label>
              <input value={draft.url} onChange={(e) => set({ url: e.target.value })} className={inputCls} placeholder="https://…" />
            </div>
          )}

          {section === "doc" && (
            <>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Or link a URL</label>
                <input value={draft.url} onChange={(e) => set({ url: e.target.value })} className={inputCls} placeholder="https://…" />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className={`${btnGhost} flex items-center gap-2`}
                >
                  <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : "Upload file"}
                </button>
                {fileName && <span className="text-sm text-muted-foreground truncate">{fileName}</span>}
                {!fileName && editing?.fileUrl && (
                  <span className="text-sm text-muted-foreground">Existing file attached</span>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button
            onClick={() => onSave(draft)}
            disabled={saving || uploading || !draft.title.trim()}
            className={btnPrimary}
            data-testid="button-save-hub-item"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemRow({
  item,
  onEdit,
  onDelete,
  deleting,
}: {
  item: HubItemRec;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const href = item.fileUrl ?? item.url ?? null;
  return (
    <div className="flex items-start gap-3 py-3" data-testid={`hub-item-${item.id}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {item.fileUrl && <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
          <p className="font-bold text-sm truncate">{item.title}</p>
        </div>
        {item.subtitle && <p className="text-muted-foreground text-xs truncate">{item.subtitle}</p>}
        {item.body && <p className="text-sm mt-1 whitespace-pre-wrap">{item.body}</p>}
        {(item.phone || item.email) && (
          <p className="text-muted-foreground text-xs mt-0.5">
            {[item.phone, item.email].filter(Boolean).join(" · ")}
          </p>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-[var(--gold,#4a7000)] inline-flex items-center gap-1 mt-1"
          >
            <ExternalLink className="w-3 h-3" /> {item.fileUrl ? "Open file" : item.url}
          </a>
        )}
      </div>
      <button onClick={onEdit} className={btnGhost} aria-label="Edit" data-testid={`button-edit-hub-${item.id}`}>
        <Pencil className="w-4 h-4" />
      </button>
      {confirm ? (
        <button
          onClick={onDelete}
          disabled={deleting}
          className="px-3 py-2 bg-rose-600 text-white rounded-xl text-sm font-bold"
        >
          Confirm
        </button>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className={`${btnGhost} text-rose-600`}
          aria-label="Delete"
          data-testid={`button-delete-hub-${item.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function AdminPropertyHub({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const { data } = useGetOfficeClientHub(propertyId);

  const createItem = useOfficeCreateHubItem();
  const updateItem = useOfficeUpdateHubItem();
  const deleteItem = useOfficeDeleteHubItem();

  const [dialog, setDialog] = useState<{ section: SectionKey; editing: HubItemRec | null } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetOfficeClientHubQueryKey(propertyId) });
  const onError = (err: Error) =>
    toast({ title: "That didn't save", description: err.message, variant: "destructive" });

  const items = data?.items ?? [];
  const bySection = (key: SectionKey) => items.filter((i) => i.section === key);

  const saveDraft = (draft: {
    title: string;
    subtitle: string;
    url: string;
    body: string;
    phone: string;
    email: string;
    storagePath: string | null;
  }) => {
    if (!dialog) return;
    const payload: HubItemInput = {
      section: dialog.section,
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim() || null,
      url: draft.url.trim() || null,
      body: draft.body.trim() || null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      storagePath: draft.storagePath,
    };
    if (dialog.editing) {
      updateItem.mutate(
        { propertyId, itemId: dialog.editing.id, data: payload },
        { onSuccess: () => { setDialog(null); invalidate(); toast({ title: "Item updated" }); }, onError },
      );
    } else {
      createItem.mutate(
        { propertyId, data: payload },
        { onSuccess: () => { setDialog(null); invalidate(); toast({ title: "Item added" }); }, onError },
      );
    }
  };

  const remove = (item: HubItemRec) =>
    deleteItem.mutate(
      { propertyId, itemId: item.id },
      { onSuccess: () => { invalidate(); toast({ title: "Item removed" }); }, onError },
    );

  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3">
          <CollapsibleTrigger className="flex items-center gap-2 text-lg font-display font-bold">
            <ChevronDown className={`w-5 h-5 transition-transform ${open ? "" : "-rotate-90"}`} />
            Property Hub (client CMS)
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="pt-4 space-y-6">
          {SECTIONS.map((s) => {
            const list = bySection(s.key);
            return (
              <div key={s.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold">{s.label}</h3>
                    <p className="text-xs text-muted-foreground">{s.blurb}</p>
                  </div>
                  <button
                    onClick={() => setDialog({ section: s.key, editing: null })}
                    className={`${btnGhost} flex items-center gap-1.5`}
                    data-testid={`button-add-hub-${s.key}`}
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground font-medium py-2">Nothing here yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {list.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onEdit={() => setDialog({ section: s.key, editing: item })}
                        onDelete={() => remove(item)}
                        deleting={deleteItem.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>

      {dialog && (
        <ItemDialog
          key={dialog.editing?.id ?? "new"}
          section={dialog.section}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSave={saveDraft}
          saving={createItem.isPending || updateItem.isPending}
        />
      )}
    </div>
  );
}
