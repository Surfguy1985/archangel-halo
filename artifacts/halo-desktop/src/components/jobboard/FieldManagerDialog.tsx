/**
 * Custom columns the office keeps on job cards.
 *
 * Retiring a field keeps its values in the database — the column disappears
 * from the board but nothing is lost, so a mistaken delete is a re-add away.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateBoardField,
  useUpdateBoardField,
  useDeleteBoardField,
  getListBoardWorkspaceQueryKey,
  type BoardField,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, Loader2 } from "lucide-react";

const TYPES: { value: string; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Anything — a note, a name, a reference" },
  { value: "select", label: "Dropdown", hint: "A fixed set of choices, colour-coded on the card" },
  { value: "number", label: "Number", hint: "Counts, hours, square feet" },
  { value: "money", label: "Money", hint: "Shown as dollars" },
  { value: "date", label: "Date", hint: "A single day" },
  { value: "checkbox", label: "Checkbox", hint: "Yes or no" },
];

export function FieldManagerDialog({
  open,
  onOpenChange,
  fields,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fields: BoardField[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListBoardWorkspaceQueryKey() });

  const createField = useCreateBoardField();
  const updateField = useUpdateBoardField();
  const deleteField = useDeleteBoardField();

  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [showOnCard, setShowOnCard] = useState(true);
  const [choices, setChoices] = useState("");

  const reset = () => {
    setLabel("");
    setType("text");
    setShowOnCard(true);
    setChoices("");
  };

  const add = () => {
    const name = label.trim();
    if (!name) {
      toast({ title: "Name the field first", variant: "destructive" });
      return;
    }
    const options =
      type === "select"
        ? choices
            .split(/[\n,]/)
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => ({ value: c.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: c }))
        : null;
    if (type === "select" && !options?.length) {
      toast({ title: "Add at least one choice", variant: "destructive" });
      return;
    }
    createField.mutate(
      { data: { label: name, type, showOnCard, options } },
      {
        onSuccess: () => {
          toast({ title: `Added "${name}"`, description: "It's on every job card now." });
          reset();
          refresh();
        },
        onError: (err) =>
          toast({
            title: "Couldn't add the field",
            description: (err as any)?.data?.error ?? (err as Error).message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Card fields</DialogTitle>
          <DialogDescription>
            Extra columns the office tracks on every job. They show up in the table view, in
            filters, and — when you choose — on the board tile itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {fields.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--hairline)] px-4 py-6 text-center text-sm text-muted-foreground">
              No custom fields yet. Add one below — "Turn priority", "Inspection date", "Vendor ref".
            </p>
          ) : (
            fields.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--hairline)] bg-white px-3 py-2.5"
                data-testid={`field-row-${f.key}`}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{f.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                    {f.type === "select" && f.options?.length
                      ? ` — ${f.options.map((o) => o.label).join(", ")}`
                      : ""}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={f.showOnCard}
                    onCheckedChange={(v) =>
                      updateField.mutate(
                        { id: f.id, data: { showOnCard: v } },
                        { onSuccess: refresh },
                      )
                    }
                    aria-label={`Show ${f.label} on the card`}
                  />
                  On card
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-red-600"
                  onClick={() =>
                    deleteField.mutate(
                      { id: f.id },
                      {
                        onSuccess: () => {
                          toast({
                            title: `Retired "${f.label}"`,
                            description: "Values are kept — re-add the field to see them again.",
                          });
                          refresh();
                        },
                      },
                    )
                  }
                  aria-label={`Retire ${f.label}`}
                  data-testid={`retire-field-${f.key}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-[var(--hairline)] bg-[var(--paper,#FAFAF7)] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            New field
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="field-label" className="text-xs">Name</Label>
              <Input
                id="field-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Turn priority"
                className="h-9 bg-white"
                data-testid="new-field-label"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-9 bg-white" data-testid="new-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="font-medium">{t.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{t.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {type === "select" && (
            <div className="space-y-1.5">
              <Label htmlFor="field-choices" className="text-xs">
                Choices — one per line
              </Label>
              <textarea
                id="field-choices"
                value={choices}
                onChange={(e) => setChoices(e.target.value)}
                rows={3}
                placeholder={"Rush\nNormal\nWhen you can"}
                className="w-full rounded-xl border border-[var(--hairline)] bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9DB40F]"
                data-testid="new-field-choices"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showOnCard} onCheckedChange={setShowOnCard} />
              Show it on the board tile
            </label>
            <Button
              onClick={add}
              disabled={createField.isPending}
              className="rounded-full bg-[var(--gold-light)] text-black hover:bg-[var(--gold-light)]/90"
              data-testid="add-field"
            >
              {createField.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Add field
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
