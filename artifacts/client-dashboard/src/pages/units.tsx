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
} from 'lucide-react';

// Standard template: every property shows the same fixed grid of slots.
// Units fill slots as HALO assigns them; the rest stay as empty placeholders.
const TEMPLATE_SLOTS = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusBg(status: string): string {
  switch (status) {
    case 'red':
      return 'bg-red-500/80 border-red-600';
    case 'yellow':
      return 'bg-amber-400/80 border-amber-500';
    case 'green':
    default:
      return 'bg-emerald-500/75 border-emerald-600';
  }
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'red':
      return { cls: 'bg-red-100 text-red-700 border-red-200', label: 'Needs attention' };
    case 'yellow':
      return { cls: 'bg-amber-100 text-amber-700 border-amber-200', label: 'In progress' };
    case 'green':
    default:
      return { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'All clear' };
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
      <div className="flex aspect-[5/4] items-center justify-center rounded-md border border-dashed border-border bg-secondary/40" />
    );
  }

  const box = (
    <div
      className={`flex aspect-[5/4] items-center justify-center rounded-md border text-white shadow-sm transition-transform ${statusBg(
        unit.status,
      )} ${editing ? 'cursor-pointer' : 'cursor-pointer hover:scale-105 hover:shadow-md'}`}
      data-testid={`unit-slot-${unit.label}`}
      onClick={() => {
        if (!editing) onClick();
      }}
    >
      <span className="pointer-events-none max-w-full truncate px-1 text-[11px] font-bold leading-none">
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
      <PopoverContent className="w-56 space-y-2 p-3" align="center">
        <Label className="text-xs font-semibold">Unit label</Label>
        <Input
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          className="h-8 text-sm"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 flex-1 gap-1 text-xs"
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
            className="h-8 gap-1 text-xs"
            onClick={() => {
              onDelete(unit.id);
              setPopoverOpen(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {isLoading || !data ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span>{data.unitLabel}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                    statusPill(data.status).cls
                  }`}
                >
                  {statusPill(data.status).label}
                </span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              {data.summary && (
                <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>
              )}

              {data.facts.length > 0 && (
                <ul className="space-y-1.5">
                  {data.facts.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.links.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {data.links.map((l, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => openLink(l.url)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {l.label}
                    </Button>
                  ))}
                </div>
              )}

              {data.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {data.photos.map((p, i) => (
                    <div key={i} className="relative overflow-hidden rounded-lg border">
                      <img
                        src={p.url.startsWith('/') ? window.location.origin + p.url : p.url}
                        alt={p.phase ?? 'photo'}
                        className="h-28 w-full object-cover"
                      />
                      {p.phase && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                          {p.phase}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading unit board...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-foreground">Units Unavailable</h1>
          <p className="mt-2 text-muted-foreground">
            We couldn't load the unit status board.
          </p>
          <Button className="mt-6" onClick={() => setLocation(`/${token}`)}>
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
              Unit Status Board
            </h1>
            <p className="text-[11px] font-semibold text-muted-foreground">{propertyName}</p>
          </div>
        </div>

        {canEdit && filled > 0 && (
          <Button
            variant={editing ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-2 text-xs font-semibold"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? 'Done' : 'Edit units'}
          </Button>
        )}
      </header>

      <main className="flex-1 p-4">
        {/* Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-red-500/80" /> Needs attention
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-amber-400/80" /> In progress / pending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-emerald-500/75" /> All clear
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-dashed border-border bg-secondary/40" />{' '}
            Awaiting a unit
          </span>
          <span className="ml-auto text-[11px]">
            {filled} of {slots.length} slots in use
          </span>
        </div>

        {editing && canEdit && (
          <p className="mb-3 text-[11px] text-muted-foreground">
            Tap a unit to rename or remove it. New units appear automatically as HALO assigns
            work to them.
          </p>
        )}

        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
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
          {filled === 0 && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Boxes light up automatically as jobs, requests, and invoices are logged against
              your units in HALO.
            </p>
          )}
        </div>
      </main>

      <UnitSummarySheet
        token={token}
        unitId={selectedUnit}
        onOpenChange={(open) => !open && setSelectedUnit(null)}
      />
    </div>
  );
}
