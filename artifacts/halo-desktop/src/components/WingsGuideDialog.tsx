import { useState} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Feather} from "lucide-react";

export type GuideLang = "en" | "es";

type Section = { title: string; body: string[]};

const CONTENT: Record<GuideLang, { intro: string; sections: Section[]}> = {
  en: {
    intro:
      "Founding Wings is our crew growth program. Do great work, build your Halo Score, sponsor other crews, and earn a share of the jobs you help bring in — all tracked fairly and openly.",
    sections: [
      {
        title: "Halo Score & Tiers",
        body: [
          "Your Halo Score (0–100) is an AI-tracked performance score built from real jobs — quality of work, reliability (showing up on time), safety, and teamwork.",
          "As your score grows you move up tiers: TRAINING → BRONZE → SILVER → GOLD → PLATINUM. Higher tiers unlock more opportunity.",
        ],
     },
      {
        title: "Founding Status",
        body: [
          "The first crews to join can earn FOUNDING_50 or FOUNDING_100 status — permanent founder recognition and priority access that stays with you.",
        ],
     },
      {
        title: "First Flight",
        body: [
          "Eligible crews get first access to premium jobs. A deterministic rules engine ranks crews by Halo Score, availability, and a clean incident record.",
          "The AI never makes the final money or eligibility call — the rules engine does. AI only assists.",
        ],
     },
      {
        title: "Wingline Overrides (80/20)",
        body: [
          "When you sponsor (recruit) a crew and their job is completed, collected, AND passes AI quality review, you earn an override on that job's gross profit.",
          "80% pays out right away (your immediate payout). The other 20% goes into your Guardian Reserve.",
        ],
     },
      {
        title: "Guardian Reserve & Quality Kicker",
        body: [
          "The 20% is held for a quality window (about 45 days). If there are no callbacks or rework, it's released to you PLUS a quality kicker bonus.",
          "If verified rework costs come up, those are deducted first. Every movement is written to an audit trail you can trust.",
        ],
     },
      {
        title: "AI Runs It Daily — With a Human Promise",
        body: [
          "Every day the AI enrolls crews, tracks assignments, reviews before/after photos with vision AI, accrues overrides, settles the reserve, and writes an operator brief.",
          "Uncertain cases are escalated to a human — the AI never auto-fails your work without clear evidence.",
        ],
     },
    ],
 },
  es: {
    intro:
      "Founding Wings es nuestro programa de crecimiento para cuadrillas. Haz un gran trabajo, construye tu Halo Score, patrocina a otras cuadrillas y gana una parte de los trabajos que ayudas a traer — todo registrado de forma justa y transparente.",
    sections: [
      {
        title: "Halo Score y Niveles",
        body: [
          "Tu Halo Score (0–100) es un puntaje de desempeño rastreado por IA basado en trabajos reales — calidad del trabajo, confiabilidad (llegar a tiempo), seguridad y trabajo en equipo.",
          "A medida que sube tu puntaje avanzas de nivel: TRAINING → BRONZE → SILVER → GOLD → PLATINUM. Los niveles más altos abren más oportunidades.",
        ],
     },
      {
        title: "Estatus de Fundador",
        body: [
          "Las primeras cuadrillas en unirse pueden ganar el estatus FOUNDING_50 o FOUNDING_100 — reconocimiento permanente de fundador y acceso prioritario que se queda contigo.",
        ],
     },
      {
        title: "First Flight (Primer Vuelo)",
        body: [
          "Las cuadrillas elegibles obtienen acceso primero a los trabajos premium. Un motor de reglas determinista clasifica a las cuadrillas por Halo Score, disponibilidad y un historial limpio de incidentes.",
          "La IA nunca toma la decisión final de dinero o elegibilidad — lo hace el motor de reglas. La IA solo asiste.",
        ],
     },
      {
        title: "Wingline Overrides (80/20)",
        body: [
          "Cuando patrocinas (reclutas) a una cuadrilla y su trabajo se completa, se cobra Y pasa la revisión de calidad de la IA, ganas un override sobre la ganancia bruta de ese trabajo.",
          "El 80% se paga de inmediato (tu pago inmediato). El otro 20% va a tu Guardian Reserve.",
        ],
     },
      {
        title: "Guardian Reserve y Bono de Calidad",
        body: [
          "El 20% se retiene durante una ventana de calidad (unos 45 días). Si no hay retornos ni retrabajos, se libera para ti MÁS un bono de calidad.",
          "Si surgen costos de retrabajo verificados, se descuentan primero. Cada movimiento se registra en un historial de auditoría confiable.",
        ],
     },
      {
        title: "La IA lo Corre a Diario — Con una Promesa Humana",
        body: [
          "Cada día la IA inscribe cuadrillas, rastrea asignaciones, revisa fotos de antes/después con IA de visión, acumula overrides, liquida la reserva y escribe un resumen para operaciones.",
          "Los casos inciertos se escalan a una persona — la IA nunca reprueba tu trabajo automáticamente sin evidencia clara.",
        ],
     },
    ],
 },
};

export function WingsGuideContent({ lang}: { lang: GuideLang}) {
  const c = CONTENT[lang];
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground leading-relaxed">{c.intro}</p>
      {c.sections.map((s) => (
        <div key={s.title} className="space-y-1.5">
          <h3 className="font-display font-bold text-sm text-[var(--ink)]">
            {s.title}
          </h3>
          {s.body.map((p, i) => (
            <p key={i} className="text-sm text-muted-foreground leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export function LangToggle({
  lang,
  onChange,
}: {
  lang: GuideLang;
  onChange: (l: GuideLang) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs font-display font-bold">
      {(["en", "es"] as GuideLang[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          data-testid={`button-guide-lang-${l}`}
          className={`px-3 py-1.5   transition-colors ${
            lang === l
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-card text-muted-foreground hover:text-foreground"
         }`}
        >
          {l === "en" ? "English" : "Español"}
        </button>
      ))}
    </div>
  );
}

export function WingsGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [lang, setLang] = useState<GuideLang>("en");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 font-display">
              <Feather className="w-5 h-5 text-[var(--primary)]" />
              Wings Program Guide
            </DialogTitle>
            <LangToggle lang={lang} onChange={setLang} />
          </div>
        </DialogHeader>
        <WingsGuideContent lang={lang} />
      </DialogContent>
    </Dialog>
  );
}
