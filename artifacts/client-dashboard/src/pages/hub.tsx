import { useSessionExchange } from '@/hooks/useSessionExchange';
import React, { useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useGetClientHub,
  useCreateHubItem,
  useUpdateHubItem,
  useDeleteHubItem,
  useContactMaintenance,
  getGetClientHubQueryKey,
  type HubItemRec,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { uploadFile } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  Loader2,
  Link2,
  FileText,
  StickyNote,
  Users,
  Wrench,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Phone,
  Mail,
  Upload,
} from 'lucide-react';

type SectionKey = 'link' | 'doc' | 'card' | 'employee' | 'maintenance';

const SECTIONS: { key: SectionKey; title: string; icon: React.ElementType }[] = [
  { key: 'link', title: 'Quick Links', icon: Link2 },
  { key: 'doc', title: 'Documents', icon: FileText },
  { key: 'card', title: 'Info Cards', icon: StickyNote },
  { key: 'employee', title: 'Your Team', icon: Users },
  { key: 'maintenance', title: 'Maintenance', icon: Wrench },
];

const resolveUrl = (url: string) =>
  url.startsWith('/') ? window.location.origin + url : url;

// ---------------------------------------------------------------------------
// Item editor dialog
// ---------------------------------------------------------------------------
type ItemForm = {
  title: string;
  subtitle: string;
  url: string;
  storagePath: string;
  body: string;
  phone: string;
  email: string;
};

const emptyForm = (): ItemForm => ({
  title: '',
  subtitle: '',
  url: '',
  storagePath: '',
  body: '',
  phone: '',
  email: '',
});

function ItemDialog({
  token,
  section,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  token: string;
  section: SectionKey;
  item: HubItemRec | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyForm());
  const create = useCreateHubItem();
  const update = useUpdateHubItem();

  // Sync form when opening
  React.useEffect(() => {
    if (open) {
      setForm(
        item
          ? {
              title: item.title ?? '',
              subtitle: item.subtitle ?? '',
              url: item.url ?? '',
              storagePath: '',
              body: item.body ?? '',
              phone: item.phone ?? '',
              email: item.email ?? '',
            }
          : emptyForm(),
      );
    }
  }, [open, item]);

  const set = (k: keyof ItemForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    const up = await uploadFile(file);
    setUploading(false);
    if (!up) {
      toast({ title: 'Upload failed', variant: 'destructive' });
      return;
    }
    set('storagePath', up.objectPath);
    if (!form.title.trim()) set('title', file.name);
    toast({ title: 'File attached' });
  };

  const submit = () => {
    if (!form.title.trim()) {
      toast({ title: 'Please add a title', variant: 'destructive' });
      return;
    }
    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      url: form.url.trim() || null,
      body: form.body.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      ...(form.storagePath ? { storagePath: form.storagePath } : {}),
    };
    const onDone = () => {
      onSaved();
      onOpenChange(false);
      toast({ title: item ? 'Item updated' : 'Item added' });
    };
    const onErr = () => toast({ title: 'Could not save', variant: 'destructive' });
    if (item) {
      update.mutate({ token, itemId: item.id, data: payload }, { onSuccess: onDone, onError: onErr });
    } else {
      create.mutate({ token, data: { section, ...payload } }, { onSuccess: onDone, onError: onErr });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {item ? 'Edit' : 'Add'}{' '}
            {SECTIONS.find((s) => s.key === section)?.title.replace(/s$/, '') ?? 'item'}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto py-2">
          <Field label={section === 'employee' ? 'Name' : 'Title'}>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>

          {(section === 'link' || section === 'doc' || section === 'employee') && (
            <Field label={section === 'employee' ? 'Role' : 'Subtitle'}>
              <Input value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
            </Field>
          )}

          {(section === 'link' || section === 'doc') && (
            <Field label="URL">
              <Input
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://…"
              />
            </Field>
          )}

          {section === 'doc' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Or upload a file</Label>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {form.storagePath ? 'File attached — replace' : 'Upload file'}
              </Button>
            </div>
          )}

          {section === 'card' && (
            <Field label="Body">
              <Textarea
                rows={4}
                value={form.body}
                onChange={(e) => set('body', e.target.value)}
              />
            </Field>
          )}

          {(section === 'employee' || section === 'maintenance') && (
            <>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Email">
                <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item renderers
// ---------------------------------------------------------------------------
function ItemRow({
  item,
  canEdit,
  onEdit,
  onDelete,
}: {
  item: HubItemRec;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const editControls = canEdit && (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    </div>
  );

  if (item.section === 'link') {
    const href = item.url ? resolveUrl(item.url) : '#';
    const favicon = item.url
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.url)}&sz=32`
      : null;
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        {favicon ? (
          <img src={favicon} alt="" className="h-5 w-5 rounded" />
        ) : (
          <Link2 className="h-5 w-5 text-muted-foreground" />
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm font-semibold text-foreground hover:underline"
        >
          {item.title}
          {item.subtitle && (
            <span className="block text-xs font-normal text-muted-foreground">
              {item.subtitle}
            </span>
          )}
        </a>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        {editControls}
      </div>
    );
  }

  if (item.section === 'doc') {
    const href = item.fileUrl
      ? resolveUrl(item.fileUrl)
      : item.url
        ? resolveUrl(item.url)
        : '#';
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm font-semibold text-foreground hover:underline"
        >
          {item.title}
          {item.subtitle && (
            <span className="block text-xs font-normal text-muted-foreground">
              {item.subtitle}
            </span>
          )}
        </a>
        {editControls}
      </div>
    );
  }

  if (item.section === 'card') {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start">
          <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
          {editControls}
        </div>
        {item.body && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {item.body}
          </p>
        )}
      </div>
    );
  }

  if (item.section === 'employee') {
    return (
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-foreground">
            {item.title.charAt(0).toUpperCase()}
          </div>
          <div className="ml-3">
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
            {item.subtitle && (
              <p className="text-xs text-muted-foreground">{item.subtitle}</p>
            )}
          </div>
          {editControls}
        </div>
        <ContactChips phone={item.phone} email={item.email} />
      </div>
    );
  }

  // maintenance contact entry
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center">
        <Wrench className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="ml-3">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          {item.subtitle && (
            <p className="text-xs text-muted-foreground">{item.subtitle}</p>
          )}
        </div>
        {editControls}
      </div>
      <ContactChips phone={item.phone} email={item.email} />
    </div>
  );
}

function ContactChips({
  phone,
  email,
}: {
  phone?: string | null;
  email?: string | null;
}) {
  if (!phone && !email) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 pl-12">
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex items-center gap-1.5 rounded-full border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary"
        >
          <Phone className="h-3 w-3" /> {phone}
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-1.5 rounded-full border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary"
        >
          <Mail className="h-3 w-3" /> {email}
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact maintenance dialog
// ---------------------------------------------------------------------------
function ContactMaintenanceDialog({
  token,
  open,
  onOpenChange,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [unitNo, setUnitNo] = useState('');
  const ping = useContactMaintenance();

  const submit = () => {
    if (!message.trim()) {
      toast({ title: 'Please add a message', variant: 'destructive' });
      return;
    }
    ping.mutate(
      { token, data: { message: message.trim(), unitNo: unitNo.trim() || null } },
      {
        onSuccess: (res) => {
          setMessage('');
          setUnitNo('');
          onOpenChange(false);
          toast({ title: 'Request sent', description: res.message });
        },
        onError: () => toast({ title: 'Could not send request', variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contact maintenance</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="What's going on?">
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue…"
            />
          </Field>
          <Field label="Unit # (optional)">
            <Input value={unitNo} onChange={(e) => setUnitNo(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={ping.isPending}>
            {ping.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function HubPage() {
  const { token } = useParams<{ token: string }>();
  useSessionExchange(token);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogSection, setDialogSection] = useState<SectionKey | null>(null);
  const [editingItem, setEditingItem] = useState<HubItemRec | null>(null);
  const [deleteItem, setDeleteItem] = useState<HubItemRec | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const { data, isLoading, error } = useGetClientHub(token, {
    query: { queryKey: getGetClientHubQueryKey(token) },
  });

  const del = useDeleteHubItem();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetClientHubQueryKey(token) });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading property hub...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Hub Unavailable</h1>
          <p className="mt-2 text-muted-foreground">We couldn't load the property hub.</p>
          <Button className="mt-6" onClick={() => setLocation(`/${token}`)}>
            Back to Board
          </Button>
        </div>
      </div>
    );
  }

  const { propertyName, canEdit, items } = data;

  const confirmDelete = () => {
    if (!deleteItem) return;
    del.mutate(
      { token, itemId: deleteItem.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Item removed' });
        },
        onError: () => toast({ title: 'Could not remove', variant: 'destructive' }),
      },
    );
    setDeleteItem(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setLocation(`/${token}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-foreground leading-tight">
              Property Hub
            </h1>
            <p className="text-[11px] font-semibold text-muted-foreground">{propertyName}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4">
        {SECTIONS.map(({ key, title, icon: Icon }) => {
          const sectionItems = items.filter((i) => i.section === key);
          return (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                  <Icon className="h-4 w-4 text-primary" /> {title}
                </CardTitle>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      setEditingItem(null);
                      setDialogSection(key);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {key === 'maintenance' && (
                  <Button
                    className="mb-1 w-full gap-2 font-bold"
                    onClick={() => setContactOpen(true)}
                  >
                    <Wrench className="h-4 w-4" /> Contact maintenance
                  </Button>
                )}
                {sectionItems.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {key === 'maintenance'
                      ? 'No maintenance contacts listed.'
                      : 'Nothing here yet.'}
                  </p>
                ) : (
                  sectionItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      canEdit={canEdit}
                      onEdit={() => {
                        setEditingItem(item);
                        setDialogSection(key);
                      }}
                      onDelete={() => setDeleteItem(item)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>

      {dialogSection && (
        <ItemDialog
          token={token}
          section={dialogSection}
          item={editingItem}
          open={!!dialogSection}
          onOpenChange={(open) => {
            if (!open) {
              setDialogSection(null);
              setEditingItem(null);
            }
          }}
          onSaved={invalidate}
        />
      )}

      <ContactMaintenanceDialog
        token={token}
        open={contactOpen}
        onOpenChange={setContactOpen}
      />

      <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove “{deleteItem?.title}” from the hub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
