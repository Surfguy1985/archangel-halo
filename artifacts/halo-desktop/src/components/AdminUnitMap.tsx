import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Upload,
  Grid3x3,
  Plus,
  Trash2,
  X,
  ExternalLink,
} from "lucide-react";
import {
  useGetOfficeUnitMap,
  getGetOfficeUnitMapQueryKey,
  useOfficeUploadUnitMapImage,
  useOfficeGenerateUnitGrid,
  useOfficeCreateUnitBox,
  useOfficeUpdateUnitBox,
  useOfficeDeleteUnitBox,
  useGetOfficeUnitSummary,
  type UnitStatusRec,
} from "@workspace/api-client-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

const inputCls =
  "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--primary)]";
const btnPrimary =
  "px-5 py-2.5 bg-[var(--gold-light,#B4FF44)] text-black text-sm font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50";
const btnGhost =
  "px-4 py-2 text-sm font-bold rounded-xl border border-border hover:bg-muted transition-colors disabled:opacity-50";

const STATUS_COLORS: Record<string, { fill: string; border: string; dot: string }> = {
  red: { fill: "rgba(244,63,94,0.28)", border: "#e11d48", dot: "bg-rose-500" },
  yellow: { fill: "rgba(234,179,8,0.28)", border: "#ca8a04", dot: "bg-amber-500" },
  green: { fill: "rgba(74,112,0,0.24)", border: "#4a7000", dot: "bg-[var(--gold-light,#B4FF44)]" },
};
const colorsFor = (status: string) => STATUS_COLORS[status] ?? STATUS_COLORS.green;

// Absolute /api/... asset URLs must never be prefixed with BASE_URL.
async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string } | null> {
  try {
    const res = await fetch(`/api/storage/uploads/request-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name || "map.png",
        size: Math.max(file.size, 1),
        contentType: file.type || "image/png",
      }),
    });
    if (!res.ok) return null;
    const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };
    const put = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "image/png" },
    });
    return put.ok ? { uploadURL, objectPath } : null;
  } catch {
    return null;
  }
}

function SectionShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-card rounded-2xl p-6 shadow-sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-3">
          <CollapsibleTrigger className="flex items-center gap-2 text-lg font-display font-bold">
            <ChevronDown className={`w-5 h-5 transition-transform ${open ? "" : "-rotate-90"}`} />
            {title}
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsibleContent className="pt-4 space-y-4">{children}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function UnitSummaryPanel({
  propertyId,
  unit,
  onClose,
}: {
  propertyId: string;
  unit: UnitStatusRec;
  onClose: () => void;
}) {
  const { data, isLoading } = useGetOfficeUnitSummary(propertyId, unit.id);
  const openLink = (url: string) => {
    if (url.startsWith("/")) {
      window.open(window.location.origin + url, "_blank", "noopener,noreferrer");
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  const status = data?.status ?? unit.status;
  return (
    <div className="bg-muted rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${colorsFor(status).dot}`} />
        <h3 className="font-bold text-sm">{data?.unitLabel ?? unit.label}</h3>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground font-medium">Loading summary…</p>
      ) : (
        <>
          {data.summary && <p className="text-sm font-medium">{data.summary}</p>}
          {data.facts.length > 0 && (
            <ul className="text-xs text-muted-foreground font-medium space-y-1 list-disc pl-4">
              {data.facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {data.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.links.map((l, i) => (
                <button
                  key={i}
                  onClick={() => openLink(l.url)}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold hover:bg-background flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3" /> {l.label}
                </button>
              ))}
            </div>
          )}
          {data.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.photos.map((p, i) => (
                <img
                  key={i}
                  src={p.url}
                  alt={p.phase ?? ""}
                  className="w-16 h-16 rounded-lg object-cover border border-border"
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminUnitMap({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useGetOfficeUnitMap(propertyId, {
    query: { queryKey: getGetOfficeUnitMapQueryKey(propertyId), refetchInterval: 15000 },
  });

  const upload = useOfficeUploadUnitMapImage();
  const genGrid = useOfficeGenerateUnitGrid();
  const createBox = useOfficeCreateUnitBox();
  const updateBox = useOfficeUpdateUnitBox();
  const deleteBox = useOfficeDeleteUnitBox();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [gridCount, setGridCount] = useState("");
  const [gridReplace, setGridReplace] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetOfficeUnitMapQueryKey(propertyId) });
  const onError = (err: Error) =>
    toast({ title: "That didn't save", description: err.message, variant: "destructive" });

  const uploadMap = async (file: File) => {
    setUploading(true);
    try {
      const res = await requestUploadUrl(file);
      if (!res) throw new Error("Upload failed");
      upload.mutate(
        { propertyId, data: { objectPath: res.objectPath, contentType: file.type || null, extract: true } },
        {
          onSuccess: (r) => {
            invalidate();
            toast({
              title: "Map image updated",
              description: r.extracted ? `${r.extracted} units detected` : undefined,
            });
          },
          onError,
        },
      );
    } catch (e) {
      toast({ title: "Map upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // "24" → 24 boxes from the default start; "1000-2000" → boxes labeled 1000..2000.
  const parseGridInput = (raw: string): { count: number | null; startAt?: number } | null => {
    const s = raw.trim();
    if (!s) return { count: null };
    const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end < start) return null;
      return { count: end - start + 1, startAt: start };
    }
    if (!/^\d+$/.test(s)) return null;
    return { count: Number(s) };
  };

  const generateGrid = () => {
    const parsed = parseGridInput(gridCount);
    if (!parsed) {
      onError(new Error('Enter a count like "24" or a range like "1000-2000"'));
      return;
    }
    if ((parsed.count ?? 0) > 1500) {
      onError(new Error("That range is over 1,500 units — split it into smaller ranges"));
      return;
    }
    genGrid.mutate(
      { propertyId, data: { count: parsed.count, startAt: parsed.startAt, replace: gridReplace } },
      { onSuccess: () => { invalidate(); toast({ title: "Grid generated" }); }, onError },
    );
  };

  const addUnit = () =>
    createBox.mutate(
      { propertyId, data: { label: newLabel.trim() } },
      { onSuccess: () => { setNewLabel(""); invalidate(); toast({ title: "Unit added" }); }, onError },
    );

  const saveRename = (id: string) =>
    updateBox.mutate(
      { propertyId, unitId: id, data: { label: renameValue.trim() } },
      { onSuccess: () => { setRenameId(null); invalidate(); }, onError },
    );

  const removeUnit = (id: string) =>
    deleteBox.mutate(
      { propertyId, unitId: id },
      {
        onSuccess: () => {
          setConfirmDelId(null);
          if (selectedId === id) setSelectedId(null);
          invalidate();
          toast({ title: "Unit removed" });
        },
        onError,
      },
    );

  // Drag-to-move via pointer events → fraction deltas → update on pointerup.
  const onUnitPointerDown = (e: React.PointerEvent, unit: UnitStatusRec) => {
    if (renameId === unit.id) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id: unit.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: unit.x,
      origY: unit.y,
      moved: false,
    };
  };

  const onUnitPointerMove = (e: React.PointerEvent, unit: UnitStatusRec) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.id !== unit.id || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) {
      drag.moved = true;
    }
    setDragOffset({ id: unit.id, dx, dy });
  };

  const onUnitPointerUp = (e: React.PointerEvent, unit: UnitStatusRec) => {
    const drag = dragRef.current;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const offset = dragOffset;
    setDragOffset(null);
    if (!drag || drag.id !== unit.id) return;
    if (!drag.moved) {
      setSelectedId((prev) => (prev === unit.id ? null : unit.id));
      return;
    }
    if (!offset) return;
    const clamp = (v: number, size: number) => Math.max(0, Math.min(1 - size, v));
    const nx = clamp(drag.origX + offset.dx, unit.w);
    const ny = clamp(drag.origY + offset.dy, unit.h);
    updateBox.mutate(
      { propertyId, unitId: unit.id, data: { x: nx, y: ny } },
      { onSuccess: invalidate, onError },
    );
  };

  const units = data?.units ?? [];
  const selected = units.find((u) => u.id === selectedId) ?? null;
  const busy = upload.isPending || genGrid.isPending || createBox.isPending;

  return (
    <SectionShell
      title="Unit Status Map"
      action={
        <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider">
          {(["red", "yellow", "green"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-muted-foreground">
              <span className={`w-2.5 h-2.5 rounded-full ${colorsFor(s).dot}`} />
              {s}
            </span>
          ))}
        </div>
      }
    >
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || busy}
          className={`${btnGhost} flex items-center gap-2`}
          data-testid="button-upload-unit-map"
        >
          <Upload className="w-4 h-4" /> {uploading ? "Uploading…" : data?.imageUrl ? "Replace map" : "Upload map"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadMap(f);
            e.target.value = "";
          }}
        />
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Units</label>
            <input
              inputMode="numeric"
              value={gridCount}
              onChange={(e) => setGridCount(e.target.value)}
              placeholder={data?.unitTarget != null ? String(data.unitTarget) : "24 or 1000-2000"}
              title='A count like "24" or a numbering range like "1000-2000"'
              className={`${inputCls} w-32`}
              data-testid="input-grid-count"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground pb-3">
            <input
              type="checkbox"
              checked={gridReplace}
              onChange={(e) => setGridReplace(e.target.checked)}
              className="accent-[var(--gold-light,#B4FF44)]"
            />
            Replace
          </label>
          <button
            onClick={generateGrid}
            disabled={busy}
            className={`${btnGhost} flex items-center gap-2`}
            data-testid="button-generate-grid"
          >
            <Grid3x3 className="w-4 h-4" /> Generate grid
          </button>
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">New unit</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. 204"
              className={`${inputCls} w-32`}
              data-testid="input-new-unit-label"
            />
          </div>
          <button
            onClick={addUnit}
            disabled={busy || !newLabel.trim()}
            className={`${btnPrimary} flex items-center gap-2`}
            data-testid="button-add-unit"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {/* Map canvas */}
      <div
        ref={canvasRef}
        className="relative w-full rounded-xl border border-border overflow-hidden bg-muted select-none"
        style={{ aspectRatio: "16 / 9" }}
      >
        {data?.imageUrl && (
          <img src={data.imageUrl} alt="Unit map" className="absolute inset-0 w-full h-full object-contain" />
        )}
        {units.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground font-medium">
              No units yet — upload a map or generate a grid.
            </p>
          </div>
        ) : (
          units.map((u) => {
            const colors = colorsFor(u.status);
            const offset = dragOffset && dragOffset.id === u.id ? dragOffset : null;
            const left = (u.x + (offset?.dx ?? 0)) * 100;
            const top = (u.y + (offset?.dy ?? 0)) * 100;
            return (
              <div
                key={u.id}
                onPointerDown={(e) => onUnitPointerDown(e, u)}
                onPointerMove={(e) => onUnitPointerMove(e, u)}
                onPointerUp={(e) => onUnitPointerUp(e, u)}
                className={`absolute flex items-center justify-center rounded-md border-2 cursor-grab active:cursor-grabbing text-[10px] font-bold ${selectedId === u.id ? "ring-2 ring-offset-1 ring-[var(--ink)]" : ""}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${u.w * 100}%`,
                  height: `${u.h * 100}%`,
                  backgroundColor: colors.fill,
                  borderColor: colors.border,
                  color: "#111",
                  touchAction: "none",
                }}
                data-testid={`unit-box-${u.id}`}
                title={u.reasons.join(", ")}
              >
                {u.label}
              </div>
            );
          })
        )}
      </div>

      {/* Selected unit summary + actions */}
      {selected && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {renameId === selected.id ? (
              <>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className={`${inputCls} max-w-[12rem]`}
                  autoFocus
                />
                <button onClick={() => saveRename(selected.id)} className={btnPrimary} disabled={updateBox.isPending}>
                  Save
                </button>
                <button onClick={() => setRenameId(null)} className={btnGhost}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => { setRenameId(selected.id); setRenameValue(selected.label); }}
                  className={btnGhost}
                  data-testid={`button-rename-unit-${selected.id}`}
                >
                  Rename
                </button>
                {confirmDelId === selected.id ? (
                  <button
                    onClick={() => removeUnit(selected.id)}
                    className="px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-bold"
                  >
                    Confirm delete
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDelId(selected.id)}
                    className={`${btnGhost} text-rose-600 flex items-center gap-1.5`}
                    data-testid={`button-delete-unit-${selected.id}`}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
              </>
            )}
          </div>
          <UnitSummaryPanel propertyId={propertyId} unit={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </SectionShell>
  );
}
