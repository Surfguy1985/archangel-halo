import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortal,
  useListPortalMessages,
  useSendPortalMessage,
  useCreatePortalCheckin,
  useListPortalDocuments,
  useUploadPortalDocument,
  useGetPortalW9,
  useSubmitPortalW9,
  useSetPortalPaymentMethod,
  getGetPortalQueryKey,
  getListPortalMessagesQueryKey,
  getListPortalDocumentsQueryKey,
  getGetPortalW9QueryKey,
  type W9Data,
  type PortalBundle,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  Calendar,
  MessageSquare,
  MapPin,
  FileText,
  Wallet,
  ClipboardCheck,
  Send,
  FileUp,
  Check,
  Loader2,
  ShieldCheck,
  Download,
  PackageCheck,
} from "lucide-react";
import { downloadW9Pdf } from "@/lib/w9pdf";
import WelcomeKitTab from "./WelcomeKitTab";

type Tab =
  | "schedule"
  | "messages"
  | "documents"
  | "checkin"
  | "pay"
  | "w9"
  | "packets";

function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function CrewPortal() {
  const { token } = useParams<{ token: string }>();
  const [tab, setTab] = useState<Tab>("schedule");

  const { data: portal, isLoading, isError } = useGetPortal(token);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  if (isError || !portal) {
    return (
      <div className="min-h-screen bg-[var(--bg,#f4f2ee)] grid place-items-center px-6">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-display font-bold text-[18px]">Invalid link</div>
          <p className="text-[13px] text-muted-foreground mt-1">
            This portal link isn't valid. Ask ArchAngel for a new one.
          </p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Calendar }[] = [
    { key: "schedule", label: "Schedule", icon: Calendar },
    { key: "packets", label: "Welcome Kit", icon: PackageCheck },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "checkin", label: "Check-in", icon: MapPin },
    { key: "documents", label: "Docs", icon: FileText },
    { key: "pay", label: "Pay", icon: Wallet },
    { key: "w9", label: "W-9", icon: ClipboardCheck },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg,#f4f2ee)]">
      <header className="bg-[var(--ink)] text-white px-[18px] pt-[20px] pb-[16px]">
        <div className="text-[11px] font-display font-bold tracking-[0.18em] uppercase text-[var(--gold-light)]">
          ArchAngel · HALO
        </div>
        <div className="font-display font-bold text-[22px] tracking-[-0.01em] mt-[3px]">
          {portal.crew.name}
        </div>
        <div className="text-[12.5px] text-white/60">
          {portal.crew.trade || "Crew portal"}
        </div>
      </header>

      <div className="sticky top-0 z-10 bg-[var(--bg,#f4f2ee)] px-[12px] pt-[10px] pb-[8px] border-b border-border">
        <div className="flex gap-[4px] overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-[5px] whitespace-nowrap rounded-[10px] px-[12px] py-[8px] text-[12.5px] font-display font-bold transition-colors ${
                  tab === t.key
                    ? "bg-[var(--ink)] text-white"
                    : "bg-card text-muted-foreground"
                }`}
              >
                <Icon className="w-[14px] h-[14px]" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="px-[14px] py-[16px] pb-[40px] max-w-[560px] mx-auto">
        {tab === "schedule" && <ScheduleTab portal={portal} />}
        {tab === "packets" && <WelcomeKitTab token={token} />}
        {tab === "messages" && <MessagesTab token={token} />}
        {tab === "checkin" && <CheckinTab token={token} />}
        {tab === "documents" && <DocumentsTab token={token} />}
        {tab === "pay" && (
          <PaymentTab
            token={token}
            initialMethod={portal.crew.preferredPaymentMethod ?? ""}
            initialDetails={portal.crew.paymentDetails ?? ""}
          />
        )}
        {tab === "w9" && <W9Tab token={token} />}
      </main>
    </div>
  );
}

const card = "bg-card rounded-[16px] shadow-[var(--shadow)] p-[15px]";

function ScheduleTab({ portal }: { portal: PortalBundle }) {
  const items = portal.schedule;
  return (
    <div className="animate-in fade-in duration-200">
      <div className="text-[13px] text-muted-foreground mb-[12px]">
        Your upcoming assignments
      </div>
      {items.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[30px]`}>
          Nothing scheduled right now.
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {items.map((s) => (
            <div key={s.id} className={card}>
              <div className="flex items-center gap-[8px] mb-[4px]">
                <Calendar className="w-[14px] h-[14px] text-[var(--gold)]" />
                <span className="text-[12.5px] font-semibold">
                  {formatDay(s.scheduledOn)}
                </span>
                {s.windowStart && (
                  <span className="text-[12px] text-muted-foreground">
                    · {s.windowStart}
                  </span>
                )}
              </div>
              <div className="font-semibold text-[14.5px]">
                {s.propertyName || "Job site"}
                {s.unitNo ? ` · Unit ${s.unitNo}` : ""}
              </div>
              {s.description && (
                <div className="text-[12.5px] text-muted-foreground mt-[2px]">
                  {s.description}
                </div>
              )}
              <div className="text-[11.5px] text-muted-foreground mt-[6px] font-mono">
                {s.jobNo}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessagesTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: messages } = useListPortalMessages(token, {
    query: {
      queryKey: getListPortalMessagesQueryKey(token),
      refetchInterval: 8000,
    },
  });
  const send = useSendPortalMessage();
  const [draft, setDraft] = useState("");

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    send.mutate(
      { token, data: { body } },
      {
        onSuccess: () => {
          setDraft("");
          queryClient.invalidateQueries({
            queryKey: getListPortalMessagesQueryKey(token),
          });
        },
      },
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={`${card} mb-[10px]`}>
        <div className="flex flex-col gap-[8px] min-h-[220px] max-h-[52vh] overflow-y-auto">
          {!messages || messages.length === 0 ? (
            <div className="text-[12.5px] text-muted-foreground py-[20px] text-center">
              Say hello to the office.
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[82%] rounded-[13px] px-[12px] py-[8px] text-[13px] leading-[1.4] ${
                  m.sender === "crew"
                    ? "self-end bg-[var(--ink)] text-white rounded-br-[4px]"
                    : "self-start bg-[rgba(23,24,28,0.06)] text-foreground rounded-bl-[4px]"
                }`}
              >
                <div>{m.body}</div>
                <div
                  className={`text-[10px] mt-[3px] ${m.sender === "crew" ? "text-white/60" : "text-muted-foreground"}`}
                >
                  {m.sender === "admin" ? "ArchAngel" : "You"} · {formatWhen(m.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="flex items-end gap-[8px]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the office…"
          rows={1}
          className="flex-1 resize-none rounded-[12px] border border-border bg-card px-[13px] py-[11px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        />
        <button
          onClick={handleSend}
          disabled={send.isPending || !draft.trim()}
          aria-label="Send"
          className="w-[44px] h-[44px] shrink-0 rounded-full grid place-items-center bg-[var(--ink)] text-white disabled:opacity-40 transition-transform active:scale-[0.9]"
        >
          <Send className="w-[17px] h-[17px]" />
        </button>
      </div>
    </div>
  );
}

function CheckinTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const checkin = useCreatePortalCheckin();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  const doCheckin = () => {
    setStatus(null);
    if (!navigator.geolocation) {
      setStatus("Location isn't available on this device.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        checkin.mutate(
          {
            token,
            data: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              label: label.trim() || null,
            },
          },
          {
            onSuccess: () => {
              setBusy(false);
              setLabel("");
              setStatus("Checked in! The office can see your location.");
              queryClient.invalidateQueries({
                queryKey: getGetPortalQueryKey(token),
              });
            },
            onError: () => {
              setBusy(false);
              setStatus("Couldn't save your check-in. Try again.");
            },
          },
        );
      },
      () => {
        setBusy(false);
        setStatus("Location permission was denied.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={card}>
        <div className="grid place-items-center py-[10px]">
          <div className="w-[68px] h-[68px] rounded-full bg-[rgba(143,106,31,0.12)] grid place-items-center mb-[14px]">
            <MapPin className="w-[30px] h-[30px] text-[var(--gold)]" />
          </div>
          <div className="font-display font-bold text-[17px]">Live GPS check-in</div>
          <p className="text-[12.5px] text-muted-foreground text-center mt-[4px] mb-[16px] max-w-[300px]">
            Tap below to share your current location with the office when you
            arrive on site.
          </p>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional note (e.g. Arrived on site)"
            className="w-full rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] mb-[10px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          />
          <button
            onClick={doCheckin}
            disabled={busy}
            className="w-full flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
          >
            {busy ? (
              <>
                <Loader2 className="w-[18px] h-[18px] animate-spin" /> Getting location…
              </>
            ) : (
              <>
                <MapPin className="w-[18px] h-[18px]" /> Check in now
              </>
            )}
          </button>
          {status && (
            <div className="text-[12.5px] text-center mt-[12px] text-muted-foreground">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentsTab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: documents } = useListPortalDocuments(token);
  const upload = useUploadPortalDocument();
  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (res) => {
      await upload.mutateAsync({
        token,
        data: {
          name: res.metadata.name,
          storagePath: res.objectPath,
          contentType: res.metadata.contentType,
          size: res.metadata.size,
        },
      });
      queryClient.invalidateQueries({
        queryKey: getListPortalDocumentsQueryKey(token),
      });
    },
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="animate-in fade-in duration-200">
      <label className="w-full mb-[14px] flex items-center justify-center gap-[8px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] cursor-pointer transition-transform active:scale-[0.98]">
        <FileUp className="w-[18px] h-[18px]" />
        {isUploading ? "Uploading…" : "Upload a document"}
        <input
          type="file"
          className="hidden"
          onChange={onFilePicked}
          disabled={isUploading}
        />
      </label>
      {!documents || documents.length === 0 ? (
        <div className={`${card} text-center text-[13px] text-muted-foreground py-[26px]`}>
          No documents yet.
        </div>
      ) : (
        <div className={card}>
          {documents.map((d, idx) => {
            const url = `${base}/api/storage${d.storagePath}`;
            return (
              <div
                key={d.id}
                className={`flex items-center gap-[10px] py-[11px] ${idx !== 0 ? "border-t border-border" : ""}`}
              >
                <FileText className="w-[18px] h-[18px] text-muted-foreground shrink-0" />
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0"
                >
                  <div className="text-[13.5px] font-semibold truncate">{d.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {d.direction === "to_crew" ? "From ArchAngel" : "You uploaded"} ·{" "}
                    {formatWhen(d.createdAt)}
                  </div>
                </a>
                <a
                  href={url}
                  download={d.name}
                  className="shrink-0 w-[34px] h-[34px] grid place-items-center rounded-full bg-[var(--paper)] border border-border text-muted-foreground transition-transform active:scale-[0.94]"
                  aria-label={`Download ${d.name}`}
                >
                  <Download className="w-[16px] h-[16px]" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PAY_METHODS = ["Direct deposit (ACH)", "Check", "Zelle", "Venmo", "Cash App", "PayPal"];

function PaymentTab({
  token,
  initialMethod,
  initialDetails,
}: {
  token: string;
  initialMethod: string;
  initialDetails: string;
}) {
  const queryClient = useQueryClient();
  const save = useSetPortalPaymentMethod();
  const [method, setMethod] = useState(initialMethod);
  const [details, setDetails] = useState(initialDetails);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    save.mutate(
      {
        token,
        data: {
          preferredPaymentMethod: method || null,
          paymentDetails: details || null,
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({
            queryKey: getGetPortalQueryKey(token),
          });
          setTimeout(() => setSaved(false), 1800);
        },
      },
    );
  };

  return (
    <div className="animate-in fade-in duration-200">
      <div className={card}>
        <div className="font-display font-bold text-[16px] mb-[3px]">
          How do you want to get paid?
        </div>
        <p className="text-[12.5px] text-muted-foreground mb-[14px]">
          Pick your preferred method and add the details we'll need.
        </p>
        <div className="grid grid-cols-2 gap-[8px] mb-[14px]">
          {PAY_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`rounded-[12px] py-[11px] px-[10px] text-[13px] font-semibold border transition-colors ${
                method === m
                  ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                  : "bg-background text-foreground border-border"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <label className="block text-[12px] font-semibold text-muted-foreground mb-[6px]">
          Payment details
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder="e.g. Routing & account #, Zelle email/phone, or mailing address"
          className="w-full resize-none rounded-[12px] border border-border bg-background px-[13px] py-[11px] text-[14px] mb-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
        />
        <button
          onClick={handleSave}
          disabled={save.isPending}
          className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[12px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
        >
          {saved ? (
            <>
              <Check className="w-[17px] h-[17px]" /> Saved
            </>
          ) : (
            "Save payment method"
          )}
        </button>
      </div>
    </div>
  );
}

const TAX_CLASSES = [
  { key: "individual", label: "Individual / sole proprietor" },
  { key: "c_corp", label: "C Corporation" },
  { key: "s_corp", label: "S Corporation" },
  { key: "partnership", label: "Partnership" },
  { key: "trust_estate", label: "Trust / estate" },
  { key: "llc", label: "LLC" },
  { key: "other", label: "Other" },
];

function W9Tab({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const { data: w9, isLoading } = useGetPortalW9(token);
  const submit = useSubmitPortalW9();
  const [form, setForm] = useState<W9Data>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (w9?.data) setForm(w9.data);
  }, [w9?.data]);

  const set = (k: keyof W9Data, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const tinType = form.tinType === "ein" ? "ein" : "ssn";

  const handleSubmit = () => {
    setErr(null);
    if (!form.name || String(form.name).trim() === "") {
      setErr("Name is required (as shown on your income tax return).");
      return;
    }
    if (!form.taxClassification) {
      setErr("Select a federal tax classification.");
      return;
    }
    if (tinType === "ssn" ? !form.ssn : !form.ein) {
      setErr(`Enter your ${tinType === "ssn" ? "SSN" : "EIN"}.`);
      return;
    }
    if (!form.signature || !form.certified) {
      setErr("Type your signature and check the certification box.");
      return;
    }
    submit.mutate(
      {
        token,
        data: {
          ...form,
          signedDate: form.signedDate || new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({
            queryKey: getGetPortalW9QueryKey(token),
          });
          queryClient.invalidateQueries({
            queryKey: getGetPortalQueryKey(token),
          });
          setTimeout(() => setSaved(false), 2200);
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="grid place-items-center py-[40px]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--gold)]" />
      </div>
    );
  }

  const field =
    "w-full rounded-[11px] border border-border bg-background px-[12px] py-[10px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40";
  const lbl = "block text-[12px] font-semibold text-muted-foreground mb-[5px]";

  return (
    <div className="animate-in fade-in duration-200 flex flex-col gap-[12px]">
      <div className={card}>
        <div className="font-display font-bold text-[17px]">
          Form W-9
        </div>
        <p className="text-[12px] text-muted-foreground mt-[2px]">
          Request for Taxpayer Identification Number and Certification. Your info
          is stored securely and only visible to ArchAngel.
        </p>
        {w9?.submitted && (
          <>
          <div className="flex items-center gap-[6px] text-[12.5px] text-[var(--green,#3c7a4e)] mt-[10px]">
            <Check className="w-[15px] h-[15px]" /> Last submitted{" "}
            {formatWhen(w9.submittedAt)}
          </div>
          <button
            onClick={() => downloadW9Pdf({ ...w9.data, ...form })}
            className="w-full mt-[10px] flex items-center justify-center gap-[7px] rounded-[11px] py-[10px] text-[13px] font-display font-bold bg-card border border-border shadow-[var(--shadow)] transition-transform active:scale-[0.98]"
          >
            <Download className="w-[15px] h-[15px]" /> Download W-9 (PDF)
          </button>
          </>
        )}
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div>
          <label className={lbl}>1. Name (as shown on your income tax return)</label>
          <input
            className={field}
            value={(form.name as string) ?? ""}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className={lbl}>2. Business name / disregarded entity (if different)</label>
          <input
            className={field}
            value={(form.businessName as string) ?? ""}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>
        <div>
          <label className={lbl}>3. Federal tax classification</label>
          <div className="grid grid-cols-1 gap-[6px]">
            {TAX_CLASSES.map((c) => (
              <button
                key={c.key}
                onClick={() => set("taxClassification", c.key)}
                className={`text-left rounded-[10px] px-[12px] py-[9px] text-[13px] border transition-colors ${
                  form.taxClassification === c.key
                    ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                    : "bg-background border-border"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {form.taxClassification === "llc" && (
            <input
              className={`${field} mt-[8px]`}
              placeholder="LLC tax classification (C, S, or P)"
              value={(form.llcClassification as string) ?? ""}
              onChange={(e) => set("llcClassification", e.target.value)}
            />
          )}
          {form.taxClassification === "other" && (
            <input
              className={`${field} mt-[8px]`}
              placeholder="Describe classification"
              value={(form.otherClassification as string) ?? ""}
              onChange={(e) => set("otherClassification", e.target.value)}
            />
          )}
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <label className={lbl}>4a. Exempt payee code</label>
            <input
              className={field}
              value={(form.exemptPayeeCode as string) ?? ""}
              onChange={(e) => set("exemptPayeeCode", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>4b. FATCA code</label>
            <input
              className={field}
              value={(form.fatcaCode as string) ?? ""}
              onChange={(e) => set("fatcaCode", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div>
          <label className={lbl}>5. Address (number, street, apt/suite)</label>
          <input
            className={field}
            value={(form.address as string) ?? ""}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <div className="col-span-1">
            <label className={lbl}>City</label>
            <input
              className={field}
              value={(form.city as string) ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>State</label>
            <input
              className={field}
              value={(form.state as string) ?? ""}
              onChange={(e) => set("state", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>ZIP</label>
            <input
              className={field}
              value={(form.zip as string) ?? ""}
              onChange={(e) => set("zip", e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={lbl}>7. Account numbers (optional)</label>
          <input
            className={field}
            value={(form.accountNumbers as string) ?? ""}
            onChange={(e) => set("accountNumbers", e.target.value)}
          />
        </div>
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div className="font-display font-bold text-[14px]">
          Part I · Taxpayer Identification Number
        </div>
        <div className="flex gap-[8px]">
          <button
            onClick={() => set("tinType", "ssn")}
            className={`flex-1 rounded-[10px] py-[9px] text-[13px] font-semibold border transition-colors ${
              tinType === "ssn"
                ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                : "bg-background border-border"
            }`}
          >
            SSN
          </button>
          <button
            onClick={() => set("tinType", "ein")}
            className={`flex-1 rounded-[10px] py-[9px] text-[13px] font-semibold border transition-colors ${
              tinType === "ein"
                ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                : "bg-background border-border"
            }`}
          >
            EIN
          </button>
        </div>
        {tinType === "ssn" ? (
          <div>
            <label className={lbl}>Social Security Number</label>
            <input
              className={field}
              inputMode="numeric"
              placeholder="XXX-XX-XXXX"
              value={(form.ssn as string) ?? ""}
              onChange={(e) => set("ssn", e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label className={lbl}>Employer Identification Number</label>
            <input
              className={field}
              inputMode="numeric"
              placeholder="XX-XXXXXXX"
              value={(form.ein as string) ?? ""}
              onChange={(e) => set("ein", e.target.value)}
            />
          </div>
        )}
      </div>

      <div className={`${card} flex flex-col gap-[12px]`}>
        <div className="font-display font-bold text-[14px]">Part II · Certification</div>
        <p className="text-[11.5px] text-muted-foreground leading-[1.5]">
          Under penalties of perjury, I certify that the number shown is my
          correct taxpayer identification number, that I am not subject to backup
          withholding, that I am a U.S. person, and that any FATCA code entered is
          correct.
        </p>
        <label className="flex items-start gap-[9px] text-[13px]">
          <input
            type="checkbox"
            checked={!!form.certified}
            onChange={(e) => set("certified", e.target.checked)}
            className="mt-[2px] w-[18px] h-[18px] accent-[var(--gold)]"
          />
          <span>I certify the statements above are true and correct.</span>
        </label>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <label className={lbl}>Signature (type name)</label>
            <input
              className={field}
              value={(form.signature as string) ?? ""}
              onChange={(e) => set("signature", e.target.value)}
            />
          </div>
          <div>
            <label className={lbl}>Date</label>
            <input
              type="date"
              className={field}
              value={(form.signedDate as string) ?? ""}
              onChange={(e) => set("signedDate", e.target.value)}
            />
          </div>
        </div>
      </div>

      {err && (
        <div className="text-[12.5px] text-destructive px-[4px]">{err}</div>
      )}
      <button
        onClick={handleSubmit}
        disabled={submit.isPending}
        className="w-full flex items-center justify-center gap-[7px] rounded-[13px] py-[13px] text-[15px] font-display font-bold text-[var(--ink)] bg-[linear-gradient(135deg,var(--gold-light),var(--gold),var(--gold-dark))] shadow-[0_4px_16px_rgba(143,106,31,0.34)] disabled:opacity-60 transition-transform active:scale-[0.98]"
      >
        {saved ? (
          <>
            <Check className="w-[17px] h-[17px]" /> Submitted
          </>
        ) : submit.isPending ? (
          <>
            <Loader2 className="w-[17px] h-[17px] animate-spin" /> Submitting…
          </>
        ) : (
          "Submit W-9"
        )}
      </button>
    </div>
  );
}
