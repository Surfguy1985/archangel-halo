import { Award, Feather, Rocket, Coins, ShieldCheck, Bot, BookOpen } from "lucide-react";

export type WingsGuideLang = "en" | "es";

type Section = {
  icon: string;
  title: string;
  body: string;
};

type Content = {
  heading: string;
  intro: string;
  sections: Section[];
  footer: string;
};

const ICONS: Record<string, any> = {
  Award,
  Feather,
  Rocket,
  Coins,
  ShieldCheck,
  Bot,
};

export const wingsGuide: Record<WingsGuideLang, Content> = {
  en: {
    heading: "The Founding Wings program",
    intro:
      "Founding Wings rewards the crews who build ArchAngel with us. Do great work, help others join, and earn real money and permanent recognition. Here's how it works, in plain English.",
    sections: [
      {
        icon: "Award",
        title: "Your Halo Score & tiers",
        body: "Your Halo Score (0–100) is tracked by AI from your real jobs — quality of work, reliability (showing up on time), safety, and teamwork. As it climbs you move up the tiers: Training → Bronze → Silver → Gold → Platinum. A higher score unlocks more and better work.",
      },
      {
        icon: "Feather",
        title: "Founding status",
        body: "The first crews to join can earn Founding 50 or Founding 100 status. It's permanent recognition — a founder number that's yours forever — plus priority access to the best jobs. Founders helped build this, and it never goes away.",
      },
      {
        icon: "Rocket",
        title: "First Flight — first crack at premium jobs",
        body: "Eligible crews get first access to premium jobs. A fair rules engine ranks crews by Halo Score, availability, and a clean incident record. The AI never makes the final money or eligibility call — the rules engine does, so it's transparent and consistent.",
      },
      {
        icon: "Coins",
        title: "Wingline Overrides — 80/20",
        body: "When you sponsor (recruit) a crew and their job is completed, collected, and passes AI quality review, you earn an override on that job's gross profit. 80% pays out to you right away. The other 20% goes into your Guardian Reserve.",
      },
      {
        icon: "ShieldCheck",
        title: "Guardian Reserve & quality kicker",
        body: "The 20% is held for a quality window (about 45 days). If there are no callbacks or rework, it's released to you — plus a quality kicker bonus for clean work. Any verified rework costs are deducted first. Every move is written to an audit trail you can trust.",
      },
      {
        icon: "Bot",
        title: "AI runs it daily — with a human promise",
        body: "Every day the AI enrolls crews, tracks assignments, reviews before/after photos with vision AI, accrues overrides, and settles the reserve. When it isn't sure, it escalates to a human — it never auto-fails your work without evidence.",
      },
    ],
    footer:
      "Questions about your score, overrides, or reserve? Ask the office anytime — everything here is logged and explainable.",
  },
  es: {
    heading: "El programa Founding Wings",
    intro:
      "Founding Wings recompensa a los equipos que construyen ArchAngel con nosotros. Haz un gran trabajo, ayuda a otros a unirse, y gana dinero real y reconocimiento permanente. Así funciona, en palabras sencillas.",
    sections: [
      {
        icon: "Award",
        title: "Tu Halo Score y niveles",
        body: "Tu Halo Score (0–100) lo calcula la IA a partir de tus trabajos reales — calidad del trabajo, confiabilidad (llegar a tiempo), seguridad y trabajo en equipo. A medida que sube, avanzas de nivel: Training → Bronze → Silver → Gold → Platinum. Un puntaje más alto abre más y mejor trabajo.",
      },
      {
        icon: "Feather",
        title: "Estatus de fundador",
        body: "Los primeros equipos en unirse pueden ganar el estatus Founding 50 o Founding 100. Es un reconocimiento permanente — un número de fundador que es tuyo para siempre — más acceso prioritario a los mejores trabajos.",
      },
      {
        icon: "Rocket",
        title: "First Flight — primero en los trabajos premium",
        body: "Los equipos elegibles tienen el primer acceso a trabajos premium. Un motor de reglas justo ordena a los equipos por Halo Score, disponibilidad e historial limpio de incidentes. La IA nunca toma la decisión final de dinero o elegibilidad — lo hace el motor de reglas.",
      },
      {
        icon: "Coins",
        title: "Overrides Wingline — 80/20",
        body: "Cuando patrocinas (reclutas) a un equipo y su trabajo se completa, se cobra y pasa la revisión de calidad de la IA, ganas un override sobre la ganancia bruta de ese trabajo. El 80% se te paga de inmediato. El otro 20% va a tu Guardian Reserve.",
      },
      {
        icon: "ShieldCheck",
        title: "Guardian Reserve y bono de calidad",
        body: "El 20% se retiene por una ventana de calidad (unos 45 días). Si no hay retornos ni retrabajos, se te libera — más un bono por trabajo limpio. Cualquier costo verificado de retrabajo se descuenta primero. Todo queda en un registro de auditoría confiable.",
      },
      {
        icon: "Bot",
        title: "La IA lo maneja a diario — con una promesa humana",
        body: "Cada día la IA inscribe equipos, sigue las asignaciones, revisa las fotos de antes/después con visión IA, acumula overrides y liquida la reserva. Cuando no está segura, lo escala a una persona — nunca reprueba tu trabajo sin evidencia.",
      },
    ],
    footer:
      "¿Preguntas sobre tu puntaje, overrides o reserva? Pregunta a la oficina cuando quieras — todo aquí queda registrado y se puede explicar.",
  },
};

export function WingsGuide({
  lang,
  onLangChange,
}: {
  lang: WingsGuideLang;
  onLangChange: (l: WingsGuideLang) => void;
}) {
  const g = wingsGuide[lang];
  return (
    <div className="space-y-[12px]" data-testid="wings-guide">
      <div className="flex items-center justify-between gap-[10px]">
        <h2 className="font-display font-bold text-[19px] tracking-[-0.01em]">
          {g.heading}
        </h2>
        <div className="flex rounded-[10px] overflow-hidden border border-border shrink-0">
          {(["en", "es"] as WingsGuideLang[]).map((l) => (
            <button
              key={l}
              onClick={() => onLangChange(l)}
              data-testid={`wings-guide-lang-${l}`}
              className={`px-[12px] py-[6px] text-[12px] font-display font-bold ${
                lang === l
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card text-muted-foreground"
              }`}
            >
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[13.5px] text-muted-foreground leading-relaxed">
        {g.intro}
      </p>
      {g.sections.map((s) => {
        const Icon = ICONS[s.icon] ?? BookOpen;
        return (
          <div
            key={s.title}
            className="bg-card rounded-[14px] border border-border p-[14px] flex gap-[12px]"
          >
            <div className="w-[36px] h-[36px] rounded-[10px] bg-[var(--ink)] text-[var(--gold-light)] grid place-items-center shrink-0">
              <Icon className="w-[17px] h-[17px]" />
            </div>
            <div>
              <div className="font-display font-bold text-[14px]">{s.title}</div>
              <p className="text-[13px] text-muted-foreground leading-relaxed mt-[3px]">
                {s.body}
              </p>
            </div>
          </div>
        );
      })}
      <p className="text-[12.5px] text-muted-foreground leading-relaxed pt-[4px]">
        {g.footer}
      </p>
    </div>
  );
}

const TIER_STYLES: Record<string, string> = {
  PLATINUM: "bg-[linear-gradient(135deg,#E5E4E2,#B9B9C9)] text-[#2b2b3a] border-transparent",
  GOLD: "bg-[linear-gradient(135deg,#F7E7A8,#E3C04B)] text-[#5a4708] border-transparent",
  SILVER: "bg-[linear-gradient(135deg,#EDEDED,#C7CDD4)] text-[#3a4048] border-transparent",
  BRONZE: "bg-[linear-gradient(135deg,#E8C6A0,#C08850)] text-[#4a2e12] border-transparent",
  TRAINING: "bg-muted text-muted-foreground border-border",
};

export function TierBadge({ tier, className = "" }: { tier: string; className?: string }) {
  const style = TIER_STYLES[tier?.toUpperCase()] ?? TIER_STYLES.TRAINING;
  return (
    <span
      className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[10.5px] font-display font-bold uppercase tracking-[0.06em] border ${style} ${className}`}
    >
      {tier || "Training"}
    </span>
  );
}
