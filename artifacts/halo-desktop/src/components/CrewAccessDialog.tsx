import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCrewAccess,
  useListProperties,
  useListJobs,
  getListCrewsQueryKey,
  type CrewAccess,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ShieldCheck, Search } from "lucide-react";

const FEATURES: { key: CrewAccess["features"][number]; label: string; hint: string }[] = [
  { key: "schedule", label: "Schedule", hint: "Upcoming jobs & events (next 14 days)" },
  { key: "dispatch", label: "Dispatch", hint: "Today's member assignments & progress" },
  { key: "jobs", label: "Jobs", hint: "Job list with status (no money)" },
  { key: "properties", label: "Properties", hint: "Property list & active job counts" },
];

export function CrewAccessDialog({
  crew,
  onClose,
}: {
  crew: { id: string; name: string; access?: CrewAccess | null };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateCrewAccess();
  const { data: properties } = useListProperties();
  const { data: jobs } = useListJobs();

  const a = crew.access;
  const [features, setFeatures] = useState<string[]>(a?.features ?? []);
  const [propertyScope, setPropertyScope] = useState<"all" | "selected">(
    a?.propertyScope ?? "all",
  );
  const [propertyIds, setPropertyIds] = useState<string[]>(a?.propertyIds ?? []);
  const [jobScope, setJobScope] = useState<"all" | "selected">(a?.jobScope ?? "all");
  const [jobIds, setJobIds] = useState<string[]>(a?.jobIds ?? []);
  const [jobSearch, setJobSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const visibleJobs = useMemo(() => {
    const scoped =
      propertyScope === "selected"
        ? (jobs ?? []).filter((j) => j.propertyId && propertyIds.includes(j.propertyId))
        : (jobs ?? []);
    const q = jobSearch.trim().toLowerCase();
    const filtered = q
      ? scoped.filter((j) =>
          `${j.jobNo} ${j.description ?? ""} ${j.unitNo ?? ""}`.toLowerCase().includes(q),
        )
      : scoped;
    return filtered.slice(0, 60);
  }, [jobs, propertyScope, propertyIds, jobSearch]);

  const save = () => {
    setError(null);
    if (features.length > 0 && propertyScope === "selected" && propertyIds.length === 0) {
      setError("Pick at least one property, or switch to all properties.");
      return;
    }
    if (features.length > 0 && jobScope === "selected" && jobIds.length === 0) {
      setError("Pick at least one job, or switch to all jobs.");
      return;
    }
    update.mutate(
      {
        id: crew.id,
        data: {
          features: features as CrewAccess["features"],
          propertyScope,
          propertyIds: propertyScope === "selected" ? propertyIds : [],
          jobScope,
          jobIds: jobScope === "selected" ? jobIds : [],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrewsQueryKey() });
          onClose();
        },
        onError: () => setError("Couldn't save access. Try again."),
      },
    );
  };

  const noAccess = features.length === 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--gold)]" />
            Office access — {crew.name}
          </DialogTitle>
          <DialogDescription>
            Choose what {crew.name} can see in their portal link. Everything is
            read-only, money is never shown, and they never get into this app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Features
            </div>
            <div className="space-y-1.5">
              {FEATURES.map((f) => (
                <label
                  key={f.key}
                  className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-black/[0.03] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={features.includes(f.key)}
                    onChange={() => setFeatures((xs) => toggle(xs, f.key))}
                  />
                  <span>
                    <span className="text-sm font-semibold text-[var(--ink)] block">
                      {f.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!noAccess && (
            <>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Properties
                </div>
                <div className="flex gap-2 mb-2">
                  {(["all", "selected"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setPropertyScope(s)}
                      className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${
                        propertyScope === s
                          ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                          : "bg-card border-[var(--hairline)] text-muted-foreground"
                      }`}
                    >
                      {s === "all" ? "All properties" : "Only these"}
                    </button>
                  ))}
                </div>
                {propertyScope === "selected" && (
                  <div className="max-h-40 overflow-y-auto border border-[var(--hairline)] rounded-xl p-2 space-y-1">
                    {(properties ?? []).map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-black/[0.03] cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={propertyIds.includes(p.id)}
                          onChange={() => setPropertyIds((xs) => toggle(xs, p.id))}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Jobs
                </div>
                <div className="flex gap-2 mb-2">
                  {(["all", "selected"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setJobScope(s)}
                      className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${
                        jobScope === s
                          ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                          : "bg-card border-[var(--hairline)] text-muted-foreground"
                      }`}
                    >
                      {s === "all" ? "All jobs in scope" : "Only these"}
                    </button>
                  ))}
                </div>
                {jobScope === "selected" && (
                  <>
                    <div className="relative mb-2">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={jobSearch}
                        onChange={(e) => setJobSearch(e.target.value)}
                        placeholder="Search jobs…"
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-[var(--hairline)] bg-white"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto border border-[var(--hairline)] rounded-xl p-2 space-y-1">
                      {visibleJobs.map((j) => (
                        <label
                          key={j.id}
                          className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-black/[0.03] cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={jobIds.includes(j.id)}
                            onChange={() => setJobIds((xs) => toggle(xs, j.id))}
                          />
                          <span className="truncate">
                            {j.jobNo}
                            {j.unitNo ? ` · Unit ${j.unitNo}` : ""}
                            {j.description ? ` — ${j.description}` : ""}
                          </span>
                        </label>
                      ))}
                      {visibleJobs.length === 0 && (
                        <div className="text-xs text-muted-foreground px-1.5 py-2">
                          No jobs match.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              {noAccess
                ? "No office access — their portal stays as-is."
                : "Their live link updates immediately."}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold rounded-lg hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={update.isPending}
                className="btn-gold px-4 py-2 text-sm"
              >
                {update.isPending ? "Saving…" : "Save access"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
