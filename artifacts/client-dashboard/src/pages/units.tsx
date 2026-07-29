import React, { useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useGetUnitMap,
  useUploadUnitMapImage,
  useGenerateUnitGrid,
  useCreateUnitBox,
  useUpdateUnitBox,
  useDeleteUnitBox,
  useGetUnitSummary,
  getGetUnitMapQueryKey,
  getGetUnitSummaryQueryKey,
  type UnitStatusRec,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { uploadFile } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Loader2,
  Upload,
  Grid3x3,
  Plus,
  Pencil,
  Check,
  Trash2,
  ImageIcon,
  ExternalLink,
} from 'lucide-react';

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

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---------------------------------------------------------------------------
// Unit box (draggable + resizable in edit mode)
// ---------------------------------------------------------------------------
type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
};

function UnitBox({
  unit,
  editing,
  canvasRef,
  onClick,
  onCommit,
  onRename,
  onDelete,
}: {
  unit: UnitStatusRec;
  editing: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onClick: () => void;
  onCommit: (id: string, patch: { x: number; y: number; w: number; h: number }) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(unit.label);

  const pos = live ?? { x: unit.x, y: unit.y, w: unit.w, h: unit.h };

  const beginDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'resize',
  ) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({
      id: unit.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: unit.x,
      origY: unit.y,
      origW: unit.w,
      origH: unit.h,
    });
    setLive({ x: unit.x, y: unit.y, w: unit.w, h: unit.h });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    if (drag.mode === 'move') {
      setLive({
        x: clamp01(drag.origX + dx),
        y: clamp01(drag.origY + dy),
        w: drag.origW,
        h: drag.origH,
      });
    } else {
      setLive({
        x: drag.origX,
        y: drag.origY,
        w: Math.max(0.03, Math.min(1 - drag.origX, drag.origW + dx)),
        h: Math.max(0.03, Math.min(1 - drag.origY, drag.origH + dy)),
      });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (live) onCommit(unit.id, live);
    setDrag(null);
    setLive(null);
  };

  const box = (
    <div
      className={`absolute flex items-center justify-center rounded-md border text-white shadow-sm transition-shadow ${statusBg(
        unit.status,
      )} ${editing ? 'cursor-move touch-none' : 'cursor-pointer'}`}
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        width: `${pos.w * 100}%`,
        height: `${pos.h * 100}%`,
      }}
      onPointerDown={(e) => editing && beginDrag(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onClick={(e) => {
        if (editing) {
          e.stopPropagation();
          return;
        }
        onClick();
      }}
    >
      <span className="pointer-events-none max-w-full truncate px-1 text-[10px] font-bold leading-none">
        {unit.label}
      </span>
      {editing && (
        <span
          className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-full border border-white bg-foreground touch-none"
          onPointerDown={(e) => beginDrag(e, 'resize')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      )}
    </div>
  );

  if (!editing) return box;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <div
          className={`absolute flex items-center justify-center rounded-md border text-white shadow-sm ${statusBg(
            unit.status,
          )} cursor-move touch-none`}
          style={{
            left: `${pos.x * 100}%`,
            top: `${pos.y * 100}%`,
            width: `${pos.w * 100}%`,
            height: `${pos.h * 100}%`,
          }}
          onPointerDown={(e) => beginDrag(e, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          <span className="pointer-events-none max-w-full truncate px-1 text-[10px] font-bold leading-none">
            {unit.label}
          </span>
          <span
            className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-full border border-white bg-foreground touch-none"
            onPointerDown={(e) => beginDrag(e, 'resize')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          />
        </div>
      </PopoverTrigger>
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [gridCount, setGridCount] = useState('');
  const [gridReplace, setGridReplace] = useState(true);

  const { data, isLoading, error } = useGetUnitMap(token, {
    query: {
      queryKey: getGetUnitMapQueryKey(token),
      refetchInterval: 10000,
    },
  });

  const uploadImage = useUploadUnitMapImage();
  const generateGrid = useGenerateUnitGrid();
  const createBox = useCreateUnitBox();
  const updateBox = useUpdateUnitBox();
  const deleteBox = useDeleteUnitBox();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetUnitMapQueryKey(token) });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-medium">Loading unit map...</p>
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
            We couldn't load the unit status map.
          </p>
          <Button className="mt-6" onClick={() => setLocation(`/${token}`)}>
            Back to Board
          </Button>
        </div>
      </div>
    );
  }

  const { propertyName, imageUrl, canEdit, unitTarget, units } = data;

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please choose an image file', variant: 'destructive' });
      return;
    }
    setUploading(true);
    const up = await uploadFile(file);
    if (!up) {
      setUploading(false);
      toast({ title: 'Upload failed', variant: 'destructive' });
      return;
    }
    uploadImage.mutate(
      { token, data: { objectPath: up.objectPath, contentType: up.contentType, extract: true } },
      {
        onSuccess: (res) => {
          setUploading(false);
          invalidate();
          toast({
            title: 'Map updated',
            description:
              res.extracted != null
                ? `Found ${res.extracted} unit${res.extracted === 1 ? '' : 's'} on your map.`
                : 'Map image saved.',
          });
        },
        onError: () => {
          setUploading(false);
          toast({ title: 'Could not read the map', variant: 'destructive' });
        },
      },
    );
  };

  const submitGrid = () => {
    const count = gridCount.trim() ? parseInt(gridCount, 10) : unitTarget ?? undefined;
    generateGrid.mutate(
      { token, data: { count: count ?? undefined, replace: gridReplace } },
      {
        onSuccess: () => {
          setGridOpen(false);
          invalidate();
          toast({ title: 'Grid generated' });
        },
        onError: () => toast({ title: 'Could not generate grid', variant: 'destructive' }),
      },
    );
  };

  const addUnit = () => {
    const label = window.prompt('Unit label (e.g. 101)');
    if (!label || !label.trim()) return;
    createBox.mutate(
      { token, data: { label: label.trim() } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Unit added' });
        },
        onError: () => toast({ title: 'Could not add unit', variant: 'destructive' }),
      },
    );
  };

  const commitBox = (id: string, patch: { x: number; y: number; w: number; h: number }) => {
    updateBox.mutate(
      { token, unitId: id, data: patch },
      { onSuccess: invalidate },
    );
  };

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

  const isEmpty = units.length === 0 && !imageUrl;

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
              Unit Status Map
            </h1>
            <p className="text-[11px] font-semibold text-muted-foreground">{propertyName}</p>
          </div>
        </div>

        {canEdit && !isEmpty && (
          <Button
            variant={editing ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-2 text-xs font-semibold"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? 'Done' : 'Edit layout'}
          </Button>
        )}
      </header>

      <main className="flex-1 p-4">
        {/* Edit toolbar */}
        {editing && canEdit && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/30 p-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPickImage}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {uploading ? 'Reading your map…' : 'Upload map image'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={() => {
                setGridCount(unitTarget ? String(unitTarget) : '');
                setGridOpen(true);
              }}
            >
              <Grid3x3 className="h-3.5 w-3.5" /> Generate grid
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={addUnit}
            >
              <Plus className="h-3.5 w-3.5" /> Add unit
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Drag boxes to move · use the corner handle to resize · tap a box to rename or delete
            </span>
          </div>
        )}

        {/* Legend */}
        {!isEmpty && (
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
          </div>
        )}

        {isEmpty ? (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            {canEdit ? (
              <>
                <h2 className="text-lg font-bold text-foreground">Set up your unit map</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a property map to auto-detect units, or generate a simple grid to get
                  started.
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPickImage}
                  />
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploading ? 'Reading your map…' : 'Upload map'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      setGridCount(unitTarget ? String(unitTarget) : '');
                      setGridOpen(true);
                    }}
                  >
                    <Grid3x3 className="h-4 w-4" /> Generate grid
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-foreground">
                  Your layout isn't set up yet
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your property manager hasn't configured the unit map yet. Check back soon.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            <div
              ref={canvasRef}
              className="relative w-full overflow-hidden rounded-xl border bg-secondary/40"
              style={imageUrl ? undefined : { aspectRatio: '16 / 10' }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={propertyName}
                  className="block w-full select-none"
                  draggable={false}
                />
              ) : null}
              {units.map((u) => (
                <UnitBox
                  key={u.id}
                  unit={u}
                  editing={editing && canEdit}
                  canvasRef={canvasRef}
                  onClick={() => setSelectedUnit(u.id)}
                  onCommit={commitBox}
                  onRename={renameBox}
                  onDelete={removeBox}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Grid dialog */}
      <Dialog open={gridOpen} onOpenChange={setGridOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate unit grid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="grid-count" className="text-sm">
                Number of units
              </Label>
              <Input
                id="grid-count"
                type="number"
                min={1}
                value={gridCount}
                onChange={(e) => setGridCount(e.target.value)}
                placeholder={unitTarget ? String(unitTarget) : 'e.g. 12'}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={gridReplace}
                onCheckedChange={(v) => setGridReplace(v === true)}
              />
              Replace the existing layout
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGridOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitGrid} disabled={generateGrid.isPending}>
              {generateGrid.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnitSummarySheet
        token={token}
        unitId={selectedUnit}
        onOpenChange={(open) => !open && setSelectedUnit(null)}
      />
    </div>
  );
}
