/**
 * A custom field value: a read-only pill on tiles, an editable cell in the
 * table. Edits save on blur/change straight to the job — no row-level save
 * button, which is what makes a table view worth using for bulk clean-up.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSetJobCustomFields,
  getListJobBoardQueryKey,
  type BoardField,
} from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { customColor, formatCustom } from "@/lib/boardWorkspace";

/** Read-only pill — board tiles and list rows. */
export function CustomFieldPill({ field, value }: { field: BoardField; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  const color = customColor(value, field);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={
        color
          ? { borderColor: `${color}55`, backgroundColor: `${color}18`, color }
          : undefined
      }
      title={`${field.label}: ${formatCustom(value, field)}`}
    >
      {!color && <span className="text-muted-foreground">{field.label}</span>}
      <span className="truncate">{formatCustom(value, field)}</span>
    </span>
  );
}

const CLEAR = "__clear__";

/** Editable cell — table view. */
export function CustomFieldCell({
  jobId,
  field,
  value,
}: {
  jobId: string;
  field: BoardField;
  value: unknown;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = useSetJobCustomFields();
  const [local, setLocal] = useState(value ?? "");

  // A background refetch of the board must not clobber what's on screen while
  // someone is typing; sync only when the row's stored value actually changes.
  useEffect(() => setLocal(value ?? ""), [value]);

  const commit = (next: unknown) => {
    if ((next ?? "") === (value ?? "")) return;
    save.mutate(
      { id: jobId, data: { values: { [field.key]: next } } },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: getListJobBoardQueryKey() }),
        onError: (err) => {
          setLocal(value ?? "");
          toast({
            title: `Couldn't save ${field.label}`,
            description: (err as any)?.data?.error ?? (err as Error).message,
            variant: "destructive",
          });
        },
      },
    );
  };

  if (field.type === "checkbox") {
    return (
      <Checkbox
        checked={!!local}
        onCheckedChange={(v) => {
          setLocal(!!v);
          commit(!!v);
        }}
        aria-label={field.label}
        data-testid={`cf-${field.key}-${jobId}`}
      />
    );
  }

  if (field.type === "select") {
    return (
      <Select
        value={String(local || "")}
        onValueChange={(v) => {
          const next = v === CLEAR ? null : v;
          setLocal(next ?? "");
          commit(next);
        }}
      >
        <SelectTrigger
          className="h-7 w-full border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-[var(--hairline)] hover:bg-white focus:border-[var(--hairline)]"
          data-testid={`cf-${field.key}-${jobId}`}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          <SelectItem value={CLEAR}>Clear</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const inputType =
    field.type === "date" ? "date" : field.type === "number" || field.type === "money" ? "number" : "text";

  return (
    <input
      type={inputType}
      value={String(local ?? "")}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => commit(e.target.value === "" ? null : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setLocal(value ?? "");
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="—"
      aria-label={field.label}
      className="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-xs text-[var(--ink)] transition-colors hover:border-[var(--hairline)] hover:bg-white focus:border-[var(--hairline)] focus:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9DB40F]"
      data-testid={`cf-${field.key}-${jobId}`}
    />
  );
}
