import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalPackets,
  useGetPortalPacket,
  useSavePortalPacket,
  useSubmitPortalPacket,
  getListPortalPacketsQueryKey,
  getGetPortalPacketQueryKey,
  type CrewPacket,
} from "@workspace/api-client-react";
import {
  getTemplate,
  applicableForms,
  completableForms,
  type PacketForm,
  type PacketField,
  type SignatureValue,
  type PacketAttachmentValue,
} from "@workspace/onboarding-packet";
import { useUpload } from "@workspace/object-storage-web";
import {
  PackageCheck,
  FileText,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  ExternalLink,
  Plus,
  X,
} from "lucide-react";

const card = "bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px]";

function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type FormsData = Record<string, Record<string, unknown>>;
type Signatures = Record<string, SignatureValue>;
type Attachments = Record<string, PacketAttachmentValue[]>;

export default function WelcomeKitTab({ token }: { token: string }) {
  const { data: packets, isLoading } = useListPortalPackets(token, {
    query: {
      queryKey: getListPortalPacketsQueryKey(token),
      refetchInterval: 8000,
    },
  });
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="grid place-items-center py-[40px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  if (openId) {
    return (
      <PacketRunner
        token={token}
        packetId={openId}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="animate-in fade-in duration-200">
      <div className="text-[13px] text-muted-foreground mb-[12px]">
        Onboarding packets from ArchAngel
      </div>
      {!packets || packets.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[30px]`}>
          No onboarding packets yet.
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {packets.map((p) => (
            <PacketCard key={p.id} packet={p} onOpen={() => setOpenId(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PacketCard({
  packet,
  onOpen,
}: {
  packet: CrewPacket;
  onOpen: () => void;
}) {
  const tpl = getTemplate(packet.templateKey);
  const submitted = packet.status === "submitted";
  const label =
    submitted
      ? "Completed"
      : packet.status === "in_progress"
        ? "In progress"
        : "New";
  const chip = submitted
    ? "bg-[rgba(60,122,78,0.14)] text-[var(--green,#3c7a4e)]"
    : packet.status === "in_progress"
      ? "bg-[rgba(143,106,31,0.14)] text-[var(--gold-dark)]"
      : "bg-[rgba(59,111,181,0.14)] text-[var(--blue)]";

  return (
    <button
      onClick={onOpen}
      className={`${card} text-left flex items-center gap-[12px] transition-transform active:scale-[0.99]`}
    >
      <div className="w-[42px] h-[42px] rounded-[12px] bg-[rgba(143,106,31,0.12)] grid place-items-center shrink-0">
        <PackageCheck className="w-[20px] h-[20px] text-[var(--gold)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-[15px] truncate">
          {tpl?.label ?? packet.templateKey}
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          {submitted
            ? `Submitted ${formatWhen(packet.submittedAt)}`
            : `Sent ${formatWhen(packet.sentAt)}`}
        </div>
      </div>
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.06em] px-[8px] py-[3px] rounded-full shrink-0 ${chip}`}
      >
        {label}
      </span>
      <ChevronRight className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
    </button>
  );
}

function PacketRunner({
  token,
  packetId,
  onBack,
}: {
  token: string;
  packetId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: packet, isLoading } = useGetPortalPacket(token, packetId, {
    query: { queryKey: getGetPortalPacketQueryKey(token, packetId) },
  });
  const save = useSavePortalPacket();
  const submitPacket = useSubmitPortalPacket();

  const tpl = packet ? getTemplate(packet.templateKey) : null;

  const [insured, setInsured] = useState<boolean | null>(null);
  const [ach, setAch] = useState<boolean | null>(null);
  const [formsData, setFormsData] = useState<FormsData>({});
  const [signatures, setSignatures] = useState<Signatures>({});
  const [attachments, setAttachments] = useState<Attachments>({});
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!packet) return;
    const app = (packet.applicability as { insured?: boolean; ach?: boolean } | null) ?? null;
    if (app) {
      if (typeof app.insured === "boolean") setInsured(app.insured);
      if (typeof app.ach === "boolean") setAch(app.ach);
    }
    setFormsData((packet.formsData as FormsData | null) ?? {});
    setSignatures((packet.signatures as Signatures | null) ?? {});
    setAttachments((packet.attachments as Attachments | null) ?? {});
    if (packet.status === "submitted") setDone(true);
  }, [packet]);

  const answers = { insured: insured === true, ach: ach === true };
  const steps: PacketForm[] = useMemo(
    () => (tpl ? completableForms(tpl, answers) : []),
    [tpl, answers.insured, answers.ach],
  );
  const allApplicable: PacketForm[] = useMemo(
    () => (tpl ? applicableForms(tpl, answers) : []),
    [tpl, answers.insured, answers.ach],
  );

  if (isLoading || !packet || !tpl) {
    return (
      <div className="grid place-items-center py-[40px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  // Step 0 = intake, 1..N = forms, N+1 = review.
  const totalSteps = steps.length + 2;
  const isIntake = step === 0;
  const isReview = step === steps.length + 1;
  const currentForm = !isIntake && !isReview ? steps[step - 1] : null;

  const persist = (overrides?: Partial<CrewPacket>, status = "in_progress") =>
    save.mutateAsync({
      token,
      packetId,
      data: {
        status,
        applicability: { insured: answers.insured, ach: answers.ach },
        formsData,
        signatures,
        attachments,
        ...overrides,
      },
    });

  const goNext = async () => {
    setErr(null);
    if (isIntake) {
      if (insured === null || ach === null) {
        setErr("Please answer both questions to continue.");
        return;
      }
      try {
        await persist();
      } catch {
        setErr("Couldn't save your progress. Check your connection and try again.");
        return;
      }
      setStep(1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (currentForm) {
      const v = validateForm(currentForm, formsData[currentForm.code], signatures[currentForm.code], attachments[currentForm.code]);
      if (v) {
        setErr(v);
        return;
      }
      try {
        await persist();
      } catch {
        setErr("Couldn't save your progress. Check your connection and try again.");
        return;
      }
      setStep((s) => s + 1);
      window.scrollTo({ top: 0 });
      return;
    }
  };

  const goBack = () => {
    setErr(null);
    if (step === 0) {
      onBack();
      return;
    }
    setStep((s) => s - 1);
    window.scrollTo({ top: 0 });
  };

  const doSubmit = async () => {
    setErr(null);
    for (const f of steps) {
      const v = validateForm(f, formsData[f.code], signatures[f.code], attachments[f.code]);
      if (v) {
        setErr(`${f.title}: ${v}`);
        return;
      }
    }
    try {
      await submitPacket.mutateAsync({
        token,
        packetId,
        data: {
          applicability: { insured: answers.insured, ach: answers.ach },
          formsData,
          signatures,
          attachments,
        },
      });
    } catch {
      setErr("Couldn't submit your packet. Check your connection and try again.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: getListPortalPacketsQueryKey(token) });
    queryClient.invalidateQueries({ queryKey: getGetPortalPacketQueryKey(token, packetId) });
    setDone(true);
    window.scrollTo({ top: 0 });
  };

  if (done) {
    return (
      <div className="animate-in fade-in duration-200">
        <div className={`${card} text-center py-[34px]`}>
          <div className="w-[68px] h-[68px] rounded-full bg-[rgba(60,122,78,0.14)] grid place-items-center mx-auto mb-[14px]">
            <Check className="w-[32px] h-[32px] text-[var(--green,#3c7a4e)]" />
          </div>
          <div className="font-display font-bold text-[18px]">Packet submitted</div>
          <p className="text-[13px] text-muted-foreground mt-[4px] max-w-[320px] mx-auto">
            Thank you! ArchAngel has been notified and has everything they need to
            get you started.
          </p>
          <button
            onClick={onBack}
            className="mt-[18px] inline-flex items-center gap-[6px] rounded-[11px] px-[16px] py-[10px] text-[13.5px] font-display font-bold bg-card border border-border shadow-[var(--shadow)]"
          >
            <ChevronLeft className="w-[15px] h-[15px]" /> Back to packets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      <div className="flex items-center gap-[8px]">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-[4px] text-[13px] text-muted-foreground"
        >
          <ChevronLeft className="w-[15px] h-[15px]" /> Back
        </button>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted-foreground">
          Step {step + 1} of {totalSteps}
        </span>
      </div>

      <div className="h-[5px] rounded-full bg-[rgba(23,24,28,0.08)] overflow-hidden">
        <div
          className="h-full bg-[var(--gold-light)] transition-all duration-300"
          style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
        />
      </div>

      <div className={card}>
        <div className="text-[11px] font-display font-bold tracking-[0.14em] uppercase text-[var(--gold-dark)]">
          {tpl.label}
        </div>

        {isIntake && (
          <IntakeStep
            tpl={tpl}
            insured={insured}
            ach={ach}
            setInsured={setInsured}
            setAch={setAch}
          />
        )}

        {currentForm && (
          <FormStep
            token={token}
            templateKey={tpl.key}
            form={currentForm}
            data={formsData[currentForm.code] ?? {}}
            signature={signatures[currentForm.code]}
            attachments={attachments[currentForm.code] ?? []}
            onData={(d) =>
              setFormsData((prev) => ({ ...prev, [currentForm.code]: d }))
            }
            onSignature={(s) =>
              setSignatures((prev) => ({ ...prev, [currentForm.code]: s }))
            }
            onAttachments={(a) =>
              setAttachments((prev) => ({ ...prev, [currentForm.code]: a }))
            }
          />
        )}

        {isReview && (
          <ReviewStep
            forms={allApplicable}
            steps={steps}
            signatures={signatures}
          />
        )}
      </div>

      {err && (
        <div className="text-[12.5px] text-[var(--red,#be3c3c)] bg-[rgba(190,60,60,0.08)] rounded-[11px] px-[12px] py-[9px]">
          {err}
        </div>
      )}

      {isReview ? (
        <button
          onClick={doSubmit}
          disabled={submitPacket.isPending}
          className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {submitPacket.isPending ? (
            <>
              <Loader2 className="w-[18px] h-[18px] animate-spin" /> Submitting…
            </>
          ) : (
            <>
              <Check className="w-[18px] h-[18px]" /> Submit packet
            </>
          )}
        </button>
      ) : (
        <button
          onClick={goNext}
          disabled={save.isPending}
          className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[var(--primary)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {save.isPending ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <>
              Continue <ChevronRight className="w-[18px] h-[18px]" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function IntakeStep({
  tpl,
  insured,
  ach,
  setInsured,
  setAch,
}: {
  tpl: ReturnType<typeof getTemplate>;
  insured: boolean | null;
  ach: boolean | null;
  setInsured: (v: boolean) => void;
  setAch: (v: boolean) => void;
}) {
  if (!tpl) return null;
  const value = (key: string) => (key === "insured" ? insured : ach);
  const setValue = (key: string, v: boolean) =>
    key === "insured" ? setInsured(v) : setAch(v);
  return (
    <div className="mt-[10px] flex flex-col gap-[18px]">
      <div>
        <div className="font-display font-bold text-[17px]">
          A few quick questions
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-[2px]">
          Your answers decide which forms you'll need to complete.
        </p>
      </div>
      {tpl.intake.map((q) => (
        <div key={q.key}>
          <div className="text-[14px] font-semibold mb-[2px]">{q.label}</div>
          {q.help && (
            <p className="text-[12px] text-muted-foreground mb-[8px]">{q.help}</p>
          )}
          <div className="grid grid-cols-2 gap-[8px]">
            <button
              onClick={() => setValue(q.key, true)}
              className={`rounded-[12px] py-[11px] px-[10px] text-[13px] font-semibold border transition-colors ${
                value(q.key) === true
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-background text-foreground border-border"
              }`}
            >
              {q.yesLabel}
            </button>
            <button
              onClick={() => setValue(q.key, false)}
              className={`rounded-[12px] py-[11px] px-[10px] text-[13px] font-semibold border transition-colors ${
                value(q.key) === false
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-background text-foreground border-border"
              }`}
            >
              {q.noLabel}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FormStep({
  token,
  templateKey,
  form,
  data,
  signature,
  attachments,
  onData,
  onSignature,
  onAttachments,
}: {
  token: string;
  templateKey: string;
  form: PacketForm;
  data: Record<string, unknown>;
  signature: SignatureValue | undefined;
  attachments: PacketAttachmentValue[];
  onData: (d: Record<string, unknown>) => void;
  onSignature: (s: SignatureValue) => void;
  onAttachments: (a: PacketAttachmentValue[]) => void;
}) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const pdfUrl = form.hasSourcePdf
    ? `${base}/api/packets/templates/${templateKey}/forms/${form.code}/pdf`
    : null;

  const setField = (key: string, v: unknown) => onData({ ...data, [key]: v });

  return (
    <div className="mt-[10px] flex flex-col gap-[14px]">
      <div>
        <div className="text-[11px] font-display font-bold tracking-[0.1em] uppercase text-muted-foreground">
          Form {form.code}
        </div>
        <div className="font-display font-bold text-[18px] mt-[1px]">
          {form.title}
        </div>
        {form.intro && (
          <p className="text-[12.5px] text-muted-foreground mt-[3px]">
            {form.intro}
          </p>
        )}
      </div>

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-[8px] rounded-[12px] border border-border bg-background px-[12px] py-[11px] text-[13px] font-semibold transition-transform active:scale-[0.99]"
        >
          <FileText className="w-[16px] h-[16px] text-[var(--gold)]" />
          <span className="flex-1">Read the full document (PDF)</span>
          <ExternalLink className="w-[15px] h-[15px] text-muted-foreground" />
        </a>
      )}

      {form.fields.length > 0 && (
        <div className="flex flex-col gap-[12px]">
          {form.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={data[field.key]}
              onChange={(v) => setField(field.key, v)}
            />
          ))}
        </div>
      )}

      {form.attachments.map((att) => (
        <AttachmentInput
          key={att.key}
          token={token}
          label={att.label}
          help={att.help}
          required={att.required}
          value={attachments.find((a) => a.key === att.key)}
          onChange={(val) => {
            const rest = attachments.filter((a) => a.key !== att.key);
            onAttachments(val ? [...rest, { ...val, key: att.key }] : rest);
          }}
        />
      ))}

      {form.signature && (
        <SignatureInput
          agreeText={form.signature.agreeText}
          captureTitle={form.signature.captureTitle}
          captureCompany={form.signature.captureCompany}
          value={signature}
          onChange={onSignature}
        />
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PacketField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const lbl = "block text-[12.5px] font-semibold text-foreground mb-[5px]";
  const input =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";

  const label = (
    <label className={lbl}>
      {field.label}
      {field.required && <span className="text-[var(--red,#be3c3c)]"> *</span>}
    </label>
  );

  if (field.type === "textarea") {
    return (
      <div>
        {label}
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={field.placeholder}
          className={`${input} resize-none`}
        />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-[10px] cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-[2px] w-[18px] h-[18px] accent-[var(--gold)]"
        />
        <span className="text-[13px] leading-[1.4]">
          {field.label}
          {field.required && <span className="text-[var(--red,#be3c3c)]"> *</span>}
        </span>
      </label>
    );
  }

  if (field.type === "radio" || field.type === "select") {
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-[8px]">
          {(field.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-[11px] py-[9px] px-[13px] text-[13px] font-semibold border transition-colors ${
                value === opt.value
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-background text-foreground border-border"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "workers") {
    return (
      <WorkersInput
        label={field.label}
        required={field.required}
        value={Array.isArray(value) ? (value as Array<Record<string, string>>) : []}
        onChange={onChange}
      />
    );
  }

  const inputType =
    field.type === "email"
      ? "email"
      : field.type === "tel"
        ? "tel"
        : field.type === "date"
          ? "date"
          : "text";

  return (
    <div>
      {label}
      <input
        type={inputType}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={input}
      />
    </div>
  );
}

function WorkersInput({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: Array<Record<string, string>>;
  onChange: (v: unknown) => void;
}) {
  const rows = value.length > 0 ? value : [{ name: "", role: "" }];
  const update = (i: number, key: string, v: string) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const add = () => onChange([...rows, { name: "", role: "" }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const input =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";

  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-foreground mb-[5px]">
        {label}
        {required && <span className="text-[var(--red,#be3c3c)]"> *</span>}
      </label>
      <div className="flex flex-col gap-[8px]">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-[8px]">
            <input
              value={r.name ?? ""}
              onChange={(e) => update(i, "name", e.target.value)}
              placeholder="Full name"
              className={input}
            />
            <input
              value={r.role ?? ""}
              onChange={(e) => update(i, "role", e.target.value)}
              placeholder="Role"
              className={`${input} max-w-[120px]`}
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                className="shrink-0 w-[34px] h-[34px] grid place-items-center rounded-full bg-[rgba(23,24,28,0.06)] text-muted-foreground"
                aria-label="Remove worker"
              >
                <X className="w-[15px] h-[15px]" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-[8px] inline-flex items-center gap-[5px] text-[12.5px] font-semibold text-[var(--gold-dark)]"
      >
        <Plus className="w-[14px] h-[14px]" /> Add another worker
      </button>
    </div>
  );
}

function AttachmentInput({
  token,
  label,
  help,
  required,
  value,
  onChange,
}: {
  token: string;
  label: string;
  help?: string;
  required?: boolean;
  value: PacketAttachmentValue | undefined;
  onChange: (v: PacketAttachmentValue | null) => void;
}) {
  void token;
  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) =>
      onChange({
        key: "",
        name: res.metadata.name,
        storagePath: res.objectPath,
        contentType: res.metadata.contentType ?? null,
        size: res.metadata.size ?? null,
      }),
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-foreground mb-[2px]">
        {label}
        {required && <span className="text-[var(--red,#be3c3c)]"> *</span>}
      </label>
      {help && <p className="text-[11.5px] text-muted-foreground mb-[6px]">{help}</p>}
      {value ? (
        <div className="flex items-center gap-[10px] rounded-[12px] border border-border bg-background px-[12px] py-[10px]">
          <FileText className="w-[16px] h-[16px] text-[var(--green,#3c7a4e)] shrink-0" />
          <span className="flex-1 min-w-0 text-[13px] font-semibold truncate">
            {value.name}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[12px] font-semibold text-muted-foreground"
          >
            Remove
          </button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-[8px] rounded-[12px] border border-dashed border-border bg-background px-[12px] py-[12px] text-[13px] font-semibold text-muted-foreground cursor-pointer">
          <FileUp className="w-[16px] h-[16px]" />
          {isUploading ? "Uploading…" : "Upload file"}
          <input
            type="file"
            className="hidden"
            onChange={onFilePicked}
            disabled={isUploading}
          />
        </label>
      )}
    </div>
  );
}

function SignatureInput({
  agreeText,
  captureTitle,
  captureCompany,
  value,
  onChange,
}: {
  agreeText: string;
  captureTitle?: boolean;
  captureCompany?: boolean;
  value: SignatureValue | undefined;
  onChange: (s: SignatureValue) => void;
}) {
  const input =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";
  const set = (patch: Partial<SignatureValue>) =>
    onChange({
      typedName: value?.typedName ?? "",
      agreed: value?.agreed ?? false,
      signedDate: value?.signedDate ?? new Date().toISOString().slice(0, 10),
      title: value?.title,
      company: value?.company,
      agreedAt: value?.agreedAt,
      userAgent: value?.userAgent,
      ...patch,
    });

  return (
    <div className="rounded-[13px] border border-[var(--gold)]/40 bg-[rgba(143,106,31,0.05)] p-[13px] flex flex-col gap-[10px]">
      <div className="text-[12px] font-display font-bold tracking-[0.08em] uppercase text-[var(--gold-dark)]">
        Electronic signature
      </div>
      <div>
        <label className="block text-[12.5px] font-semibold mb-[5px]">
          Type your full legal name <span className="text-[var(--red,#be3c3c)]">*</span>
        </label>
        <input
          value={value?.typedName ?? ""}
          onChange={(e) => set({ typedName: e.target.value })}
          placeholder="Your full name"
          className={`${input} font-display`}
          style={{ fontStyle: "italic" }}
        />
      </div>
      {captureTitle && (
        <div>
          <label className="block text-[12.5px] font-semibold mb-[5px]">Title</label>
          <input
            value={value?.title ?? ""}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Owner"
            className={input}
          />
        </div>
      )}
      {captureCompany && (
        <div>
          <label className="block text-[12.5px] font-semibold mb-[5px]">Company</label>
          <input
            value={value?.company ?? ""}
            onChange={(e) => set({ company: e.target.value })}
            placeholder="Company name"
            className={input}
          />
        </div>
      )}
      <label className="flex items-start gap-[10px] cursor-pointer">
        <input
          type="checkbox"
          checked={value?.agreed ?? false}
          onChange={(e) =>
            set({
              agreed: e.target.checked,
              agreedAt: e.target.checked ? new Date().toISOString() : undefined,
              userAgent: e.target.checked ? navigator.userAgent : undefined,
            })
          }
          className="mt-[2px] w-[18px] h-[18px] accent-[var(--gold)]"
        />
        <span className="text-[12.5px] leading-[1.45]">{agreeText}</span>
      </label>
      <div className="text-[11px] text-muted-foreground">
        Signing date: {value?.signedDate ?? new Date().toISOString().slice(0, 10)}
      </div>
    </div>
  );
}

function ReviewStep({
  forms,
  steps,
  signatures,
}: {
  forms: PacketForm[];
  steps: PacketForm[];
  signatures: Signatures;
}) {
  const stepCodes = new Set(steps.map((s) => s.code));
  return (
    <div className="mt-[10px] flex flex-col gap-[12px]">
      <div>
        <div className="font-display font-bold text-[17px]">
          Review & submit
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-[2px]">
          Here's everything in your packet. Submit when you're ready.
        </p>
      </div>
      <div className="flex flex-col">
        {forms.map((f, idx) => {
          const needsSign = stepCodes.has(f.code) && f.signature;
          const signed = signatures[f.code]?.agreed && signatures[f.code]?.typedName;
          return (
            <div
              key={f.code}
              className={`flex items-center gap-[10px] py-[9px] ${idx !== 0 ? "border-t border-border" : ""}`}
            >
              <FileText className="w-[15px] h-[15px] text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 text-[13px] truncate">
                <span className="text-muted-foreground">Form {f.code}</span> · {f.title}
              </span>
              {needsSign ? (
                signed ? (
                  <span className="inline-flex items-center gap-[3px] text-[11px] font-bold text-[var(--green,#3c7a4e)]">
                    <Check className="w-[13px] h-[13px]" /> Signed
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-[var(--red,#be3c3c)]">
                    Not signed
                  </span>
                )
              ) : (
                <span className="text-[11px] text-muted-foreground">Included</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function validateForm(
  form: PacketForm,
  data: Record<string, unknown> | undefined,
  signature: SignatureValue | undefined,
  attachments: PacketAttachmentValue[] | undefined,
): string | null {
  const d = data ?? {};
  for (const field of form.fields) {
    if (!field.required) continue;
    const v = d[field.key];
    if (field.type === "checkbox") {
      if (!v) return `Please check "${field.label}".`;
    } else if (field.type === "workers") {
      const rows = Array.isArray(v) ? v : [];
      const hasOne = rows.some(
        (r) => r && typeof r === "object" && String((r as Record<string, unknown>).name ?? "").trim() !== "",
      );
      if (!hasOne) return `Add at least one entry for "${field.label}".`;
    } else if (v == null || String(v).trim() === "") {
      return `"${field.label}" is required.`;
    }
  }
  for (const att of form.attachments) {
    if (att.required && !(attachments ?? []).some((a) => a.key === att.key)) {
      return `Please upload "${att.label}".`;
    }
  }
  if (form.signature) {
    if (!signature?.typedName || String(signature.typedName).trim() === "") {
      return "Please type your name to sign.";
    }
    if (!signature.agreed) {
      return "Please check the agreement box to sign.";
    }
  }
  return null;
}
