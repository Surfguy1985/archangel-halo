import { useSessionExchange } from '@/hooks/useSessionExchange';
import React, { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useGetUnitMap,
  useUpdateUnitBox,
  useDeleteUnitBox,

  useGetUnitSummary,
  getGetUnitMapQueryKey,
  getGetUnitSummaryQueryKey,
  type UnitStatusRec,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Check,
  Trash2,
  ExternalLink,
  Plus,
  LayoutGrid,
  Info
} from 'lucide-react';
import { motion } from 'framer-motion';

// Standard template: every property shows the same fixed grid of slots.
// Units fill slots as HALO assigns them; the rest stay as empty placeholders.
const TEMPLATE_SLOTS = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBg(status: string): string {
  switch (status) {
    case 'red':
      return 'bg-[#e11d48] text-white border-[#be123c]';
    case 'yellow':
      return 'bg-[#f5f0d9] text-[#77610f] border-[#e8dfb1]';
    case 'green':
    default:
      return 'bg-[#1f7a52] text-white border-[#145236]';
  }
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'red':
      return { cls: 'bg-[#f7e2de] text-[#96281b] border-[#e11d48]/20', label: 'Needs attention' };
    case 'yellow':
      return { cls: 'bg-[#f5f0d9] text-[#77610f] border-[#a86c14]/20', label: 'In progress' };
    case 'green':
    default:
      return { cls: 'bg-[#dcefe4] text-[#1f7a52] border-[#1f7a52]/20', label: 'All clear' };
  }
}

// Numeric-aware label sort so "2" comes before "10".
const labelCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------------------
// Unit slot — a fixed grid cell; filled when HALO has assigned a unit to it.
// ---------------------------------------------------------------------------
function UnitSlot({
  unit,
  editing,
  onClick,
  onRename,
  onDelete,
}: {
  unit: UnitStatusRec | null;
  editing: boolean;
  onClick: () => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(unit?.label ?? '');

  if (!unit) {
    return (
      <div className="flex aspect-[5/4] items-center justify-center rounded-[12px] border-2 border-dashed border-black/10 bg-black/[0.02] shadow-inner" />
    );
  }

  const box = (
    <div
      className={`flex aspect-[5/4] items-center justify-center rounded-[12px] border shadow-sm transition-transform ${statusBg(
        unit.status,
      )} ${editing ? 'cursor-pointer hover:ring-2 hover:ring-offset-2 hover:ring-primary' : 'cursor-pointer hover:scale-[1.03] hover:shadow-md'}`}
      data-testid={`unit-slot-${unit.label}`}
      onClick={() => {
        if (!editing) onClick();
      }}
    >
      <span className="pointer-events-none max-w-full truncate px-1 text-[13px] font-[800] leading-none tracking-tight">
        {unit.label}
      </span>
    </div>
  );

  if (!editing) return box;

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(o) => {
        setPopoverOpen(o);
        if (o) setLabelDraft(unit.label);
      }}
    >
      <PopoverTrigger asChild>{box}</PopoverTrigger>
      <PopoverContent className="w-56 p-4 rounded-[16px] border-black/10 shadow-xl" align="center">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground">Unit Label</Label>
            <Input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              className="h-10 text-[13px] font-[600] rounded-[8px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-9 flex-1 gap-1 text-[11px] font-[800] uppercase tracking-wider rounded-[8px] bg-[#d8f84e] text-[#101c33] hover:bg-[#c8e83e]"
              onClick={() => {
                if (labelDraft.trim() && labelDraft !== unit.label) {
                  onRename(unit.id, labelDraft.trim());
                }
                setPopoverOpen(false);
              }}
            >
              <Check className="h-3.5 w-3.5" /> Save
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-9 gap-1 text-[11px] font-[800] uppercase tracking-wider rounded-[8px]"
              onClick={() => {
                onDelete(unit.id);
                setPopoverOpen(false);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Unit summary panel
// ---------------------------------------------------------------------------
function UnitSummarySheet({
  token,
  unitId,
  onOpenChange,
}: {
  token: string;
  unitId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useGetUnitSummary(token, unitId ?? '', {
    query: {
      queryKey: getGetUnitSummaryQueryKey(token, unitId ?? ''),
      enabled: !!unitId,
    },
  });

  const openLink = (url: string) => {
    const href = url.startsWith('/') ? window.location.origin + url : url;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <Sheet open={!!unitId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md bg-[#fdfdfc] p-0 border-l border-black/10">
        {isLoading || !data ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col min-h-full">
            <div className="p-6 border-b border-black/5 bg-white sticky top-0 z-10 shadow-sm">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className="text-2xl font-[800] text-[#101c33]">{data.unitLabel}</span>
                  <span
                    className={`rounded-[6px] border px-2 py-1 text-[10px] font-[800] uppercase tracking-wider shadow-sm ${
                      statusPill(data.status).cls
                    }`}
                  >
                    {statusPill(data.status).label}
                  </span>
                </SheetTitle>
              </SheetHeader>
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6">
              {data.summary && (
                <div className="p-4 rounded-[12px] bg-black/[0.02] border border-black/5">
                  <p className="text-[13px] font-[500] leading-relaxed text-[#101c33]">{data.summary}</p>
                </div>
              )}

              {data.facts.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground mb-3">Unit Facts</h4>
                  <ul className="space-y-2">
                    {data.facts.map((f, i) => (
                      <li key={i} className="flex gap-3 text-[13px] font-[600] text-[#101c33]">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#33639f]" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.links.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground mb-3">Related Files</h4>
                  <div className="flex flex-wrap gap-2">
                    {data.links.map((l, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5 text-[11px] font-[800] uppercase tracking-wider rounded-[8px] bg-white hover:bg-black/5"
                        onClick={() => openLink(l.url)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> {l.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {data.photos.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-[800] uppercase tracking-widest text-muted-foreground mb-3">Recent Photos</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {data.photos.map((p, i) => (
                      <div key={i} className="relative overflow-hidden rounded-[12px] border border-black/10 shadow-inner group">
                        <img
                          src={p.url.startsWith('/') ? window.location.origin + p.url : p.url}
                          alt={p.phase ?? 'photo'}
                          className="h-32 w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        {p.phase && (
                          <span className="absolute bottom-2 left-2 rounded-[4px] bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-[800] uppercase tracking-wider text-white">
                            {p.phase}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function UnitsPage() {
  const { token } = useParams<{ token: string }>();
  useSessionExchange(token);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const { data, isLoading, error } = useGetUnitMap(token, {
    query: {
      queryKey: getGetUnitMapQueryKey(token),
      refetchInterval: 10000,
    },
  });

  const updateBox = useUpdateUnitBox();
  const deleteBox = useDeleteUnitBox();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetUnitMapQueryKey(token) });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f3f0]">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-bold tracking-widest uppercase">Loading site map...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f4f3f0]">
        <div className="max-w-md text-center bg-white p-8 rounded-[24px] shadow-xl border border-black/5">
          <h1 className="text-2xl font-[800] text-[#101c33]">Site Map Unavailable</h1>
          <p className="mt-2 text-[14px] font-[500] text-muted-foreground">
            We couldn't load the unit map.
          </p>
          <Button className="mt-6 h-11 px-8 rounded-[10px] font-[800] bg-[#d8f84e] text-[#101c33] hover:bg-[#c8e83e]" onClick={() => setLocation(`/${token}`)}>
            Back to Board
          </Button>
        </div>
      </div>
    );
  }

  const { propertyName, canEdit, units } = data;

  const renameBox = (id: string, label: string) => {
    updateBox.mutate(
      { token, unitId: id, data: { label } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Unit renamed' });
        },
        onError: () => toast({ title: 'Could not rename', variant: 'destructive' }),
      },
    );
  };

  const removeBox = (id: string) => {
    deleteBox.mutate(
      { token, unitId: id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Unit removed' });
        },
        onError: () => toast({ title: 'Could not remove', variant: 'destructive' }),
      },
    );
  };

  // Fill the fixed template in label order; extra slots stay empty.
  const sorted = [...units].sort((a, b) => labelCompare.compare(a.label, b.label));
  const slots: (UnitStatusRec | null)[] = Array.from(
    { length: TEMPLATE_SLOTS },
    (_, i) => sorted[i] ?? null,
  );

  const filled = Math.min(sorted.length, TEMPLATE_SLOTS);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-[#f4f3f0] font-sans"
    >
      {/* Header */}
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/5 bg-[#fdfdfc] px-6 shadow-sm z-50">
        <div className="flex items-center gap-5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-[10px] hover:bg-black/5"
            onClick={() => setLocation(`/${token}`)}
          >
            <ArrowLeft className="h-5 w-5 text-[#101c33]" />
          </Button>
          <div className="h-7 w-[1px] bg-black/10" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#101c33] text-white shadow-sm">
              <LayoutGrid className="h-5 w-5 text-[#d8f84e]" />
            </div>
            <div>
              <h1 className="text-[15px] font-[800] tracking-tight text-[#101c33] leading-tight">
                Site Map
              </h1>
              <p className="text-[11px] font-[600] text-muted-foreground">{propertyName}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canEdit && (
            <Button
              variant={editing ? 'default' : 'outline'}
              size="sm"
              className={`h-10 gap-2 text-[12px] font-[800] rounded-[10px] px-4 shadow-sm transition-all ${
                editing 
                  ? 'bg-[#101c33] text-white hover:bg-[#101c33]/90' 
                  : 'bg-white border-black/10 hover:bg-black/[0.02] text-[#101c33]'
              }`}
              onClick={() => setEditing((v) => !v)}
            >
              <Pencil className="h-4 w-4" /> {editing ? 'Done Editing' : 'Edit Map'}
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 md:p-8 overflow-y-auto">
        {/* Legend */}
        <div className="mx-auto max-w-5xl mb-8 flex flex-wrap items-center gap-6 text-[12px] font-[700] text-[#101c33] bg-white p-4 rounded-[16px] shadow-sm border border-black/5">
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-[4px] bg-[#e11d48] shadow-sm" /> Needs attention
          </span>
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-[4px] bg-[#f5f0d9] shadow-sm" /> In progress / pending
          </span>
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-[4px] bg-[#1f7a52] shadow-sm" /> All clear
          </span>
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-[4px] border-2 border-dashed border-black/10 bg-black/[0.02]" />{' '}
            Awaiting a unit
          </span>
          <span className="ml-auto text-[11px] font-[800] uppercase tracking-widest text-muted-foreground bg-black/5 px-2 py-1 rounded-[6px]">
            {filled} of {slots.length} slots
          </span>
        </div>

        {editing && canEdit && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-5xl mb-6 p-4 rounded-[12px] bg-[#d8f84e]/20 border border-[#d8f84e]/50 text-[13px] font-[600] text-[#101c33] flex items-center gap-3 shadow-sm"
          >
            <Info className="h-5 w-5 text-[#b6d338]" />
            Tap a unit box to rename or remove it. Add new boxes to organize your site map.
          </motion.div>
        )}

        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-5 gap-3 sm:grid-cols-8 md:grid-cols-10">
            {slots.map((unit, i) => (
              <UnitSlot
                key={unit?.id ?? `empty-${i}`}
                unit={unit}
                editing={editing && canEdit}
                onClick={() => unit && setSelectedUnit(unit.id)}
                onRename={renameBox}
                onDelete={removeBox}
              />
            ))}
          </div>
          {filled === 0 && !editing && (
            <div className="mt-16 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-black/5 flex items-center justify-center mb-4">
                <LayoutGrid className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-[16px] font-[800] text-[#101c33]">Your site map is empty</h3>
              <p className="mt-2 text-[14px] font-[500] text-muted-foreground max-w-md">
                Click "Edit Map" to add boxes, or wait for HALO to automatically generate them as jobs and requests are logged.
              </p>
            </div>
          )}
        </div>
      </main>

      <UnitSummarySheet
        token={token}
        unitId={selectedUnit}
        onOpenChange={(open) => !open && setSelectedUnit(null)}
      />
    </motion.div>
  );
}