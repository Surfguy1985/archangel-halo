import type { PortalWings } from "@workspace/api-client-react";
import { Feather, Coins, TrendingUp, Info } from "lucide-react";
import type { GuideLang } from "@/components/WingsGuideDialog";

// ---- Wings Program (quarterly profit sharing) — crew-facing explainer +
// live tracker. Copy mirrors the printed "Archangel Wings Program" sheet:
// 12% of quarterly profit goes into a pot, split by Wings:
//   Wings = (role base + founder bonus) × years multiplier × score multiplier

const METRICS: {
  key: keyof NonNullable<PortalWings["points"]>;
  max: number;
  en: { label: string; how: string };
  es: { label: string; how: string };
}[] = [
  {
    key: "quality",
    max: 35,
    en: {
      label: "Quality of work",
      how: "Inspections, customer ratings, no callbacks, no damage",
    },
    es: {
      label: "Calidad del trabajo",
      how: "Inspecciones, calificaciones del cliente, sin reclamos ni daños",
    },
  },
  {
    key: "reliability",
    max: 25,
    en: {
      label: "On time & reliable",
      how: "Showing up, arriving on time, finishing what you take",
    },
    es: {
      label: "Puntualidad y confiabilidad",
      how: "Presentarse, llegar a tiempo, terminar lo que tomas",
    },
  },
  {
    key: "professionalism",
    max: 15,
    en: {
      label: "Professionalism",
      how: "How the office and clients rate working with you",
    },
    es: {
      label: "Profesionalismo",
      how: "Cómo la oficina y los clientes califican trabajar contigo",
    },
  },
  {
    key: "safety",
    max: 15,
    en: {
      label: "Safety",
      how: "Safety checks passed and zero incidents",
    },
    es: {
      label: "Seguridad",
      how: "Revisiones de seguridad aprobadas y cero incidentes",
    },
  },
  {
    key: "team",
    max: 10,
    en: {
      label: "Team & mentorship",
      how: "Recruits you sponsor and jobs you help rescue",
    },
    es: {
      label: "Equipo y mentoría",
      how: "Reclutas que patrocinas y trabajos que ayudas a rescatar",
    },
  },
];

const ROLE_LABELS: Record<string, { en: string; es: string; wings: number }> = {
  crew: { en: "Crew member", es: "Miembro de cuadrilla", wings: 10 },
  lead: { en: "Lead hand", es: "Mano líder", wings: 15 },
  foreman: { en: "Foreman", es: "Capataz", wings: 25 },
  superintendent: { en: "Superintendent", es: "Superintendente", wings: 35 },
};

const SCORE_BANDS = [
  { range: "95–100", mult: "× 1.30" },
  { range: "90–94", mult: "× 1.15" },
  { range: "80–89", mult: "× 1.00" },
  { range: "70–79", mult: "× 0.80" },
  { range: "60–69", mult: "× 0.50" },
];

const T = {
  en: {
    trackerTitle: "How your score is built",
    trackerSub:
      "100 points total, updated live from your real jobs: safety, on time, closing out your work, photos & logs, and customer feedback. Hold 80+ and you keep a full share — that's the standard, not perfection.",
    wingsTitle: "Your Wings right now",
    wingsSub: "Every quarter, 12% of company profit goes into one pot. It's split by Wings — here are yours today:",
    role: "Role",
    founder: "Founder bonus",
    yearsHere: "Years here",
    scoreMult: "Score multiplier",
    yourWings: "Your Wings",
    formula: "Wings = (role + founder) × years × score",
    potTitle: "How the pot pays out",
    potBody:
      "At quarter close we add up everyone's Wings and divide the pot by the total — that sets what one Wing is worth. Your check is simply your Wings × that value. Wings totals are posted for everyone, so you can always check the math.",
    fairTitle: "Simple and fair",
    fairBody:
      "A score of 80–89 pays a full share — that's solid, everyday good work. 90+ pays extra. You'd have to fall under 60 to lose a quarter, and you'll see it coming in this tracker long before that.",
    scoreBandsTitle: "Score → multiplier",
    under60: "Under 60 — no share that quarter",
    rulesTitle: "The rules, plain and short",
    rules: [
      "One full year before you're eligible. No exceptions, no partial credit.",
      "Score under 60 = no share that quarter. You'll have seen it coming in the app.",
      "Willful safety violation = no share that quarter, whatever your score was.",
      "Paid 45 days after the quarter closes, once the books are final.",
      "You must still be employed on payout day. Quit or fired for cause, you forfeit that quarter.",
      "Laid off or hurt on the job? You get a prorated share for the weeks you worked.",
      "The role you hold on the last day of the quarter is the role that counts. Promotions pay immediately.",
      "You have 14 days after quarter close to dispute your score. Every point is traceable to a record.",
      "Wings totals are posted for everyone. Checks are private. You can always verify the math is fair.",
      "This is a bonus program, not ownership. You are not buying or receiving equity in Archangel.",
    ],
    blockers: {
      under_one_year:
        "You're under one year — year one you learn the job, then you're in the pot.",
      score_under_60:
        "Your score is under 60, which means no share this quarter. Pull it back up — the pot doesn't close until quarter end.",
      start_date_missing:
        "Your start date isn't on file yet — ask the office to set it so your years multiplier is right.",
    },
    eligible: "You're on track to share in this quarter's pot.",
    yrs: "yrs",
    notSet: "not set",
  },
  es: {
    trackerTitle: "Cómo se arma tu puntaje",
    trackerSub:
      "100 puntos en total, actualizados en vivo con tus trabajos reales: seguridad, puntualidad, cerrar tu trabajo, fotos y registros, y retroalimentación del cliente. Mantén 80+ y conservas tu parte completa — ese es el estándar, no la perfección.",
    wingsTitle: "Tus Wings ahora mismo",
    wingsSub:
      "Cada trimestre, el 12% de la ganancia de la empresa va a un fondo. Se reparte por Wings — estas son las tuyas hoy:",
    role: "Rol",
    founder: "Bono de fundador",
    yearsHere: "Años aquí",
    scoreMult: "Multiplicador de puntaje",
    yourWings: "Tus Wings",
    formula: "Wings = (rol + fundador) × años × puntaje",
    potTitle: "Cómo se paga el fondo",
    potBody:
      "Al cerrar el trimestre sumamos las Wings de todos y dividimos el fondo entre el total — eso define cuánto vale una Wing. Tu cheque es simplemente tus Wings × ese valor. Los totales de Wings se publican para todos, así siempre puedes verificar las cuentas.",
    fairTitle: "Simple y justo",
    fairBody:
      "Un puntaje de 80–89 paga la parte completa — eso es buen trabajo normal, de todos los días. 90+ paga extra. Tendrías que caer bajo 60 para perder un trimestre, y lo verías venir en este medidor mucho antes.",
    scoreBandsTitle: "Puntaje → multiplicador",
    under60: "Menos de 60 — sin parte ese trimestre",
    rulesTitle: "Las reglas, claras y cortas",
    rules: [
      "Un año completo antes de ser elegible. Sin excepciones, sin crédito parcial.",
      "Puntaje bajo 60 = sin parte ese trimestre. Lo verás venir en la app.",
      "Violación intencional de seguridad = sin parte ese trimestre, sin importar tu puntaje.",
      "Se paga 45 días después del cierre del trimestre, con los libros finales.",
      "Debes seguir empleado el día del pago. Si renuncias o te despiden por causa, pierdes ese trimestre.",
      "¿Despedido o lastimado en el trabajo? Recibes una parte proporcional por las semanas que trabajaste.",
      "El rol que tienes el último día del trimestre es el que cuenta. Los ascensos pagan de inmediato.",
      "Tienes 14 días después del cierre del trimestre para disputar tu puntaje. Cada punto tiene un registro.",
      "Los totales de Wings se publican para todos. Los cheques son privados. Siempre puedes verificar las cuentas.",
      "Este es un programa de bonos, no propiedad. No estás comprando ni recibiendo acciones de Archangel.",
    ],
    blockers: {
      under_one_year:
        "Llevas menos de un año — el primer año se aprende el oficio, después entras al fondo.",
      score_under_60:
        "Tu puntaje está bajo 60, lo que significa sin parte este trimestre. Levántalo — el fondo no cierra hasta fin de trimestre.",
      start_date_missing:
        "Tu fecha de inicio no está registrada — pide a la oficina que la ponga para que tu multiplicador de años sea correcto.",
    },
    eligible: "Vas en camino a compartir el fondo de este trimestre.",
    yrs: "años",
    notSet: "sin fecha",
  },
};

export function WingsProgramPanel({
  wings,
  lang,
  card,
}: {
  wings: PortalWings;
  lang: GuideLang;
  card: string;
}) {
  const t = T[lang];
  const p = wings.program;
  const points = wings.points ?? null;
  const roleInfo = p ? ROLE_LABELS[p.roleKey] : null;

  return (
    <div className="space-y-[14px]" data-testid="wings-program">
      {/* Live metric tracker */}
      <div className={card}>
        <div className="flex items-center gap-[8px] mb-[2px]">
          <TrendingUp className="w-[16px] h-[16px] text-[var(--gold-dark)]" />
          <div className="font-display font-bold text-[15px]">{t.trackerTitle}</div>
        </div>
        <p className="text-[12px] text-muted-foreground mb-[12px]">{t.trackerSub}</p>
        <div className="space-y-[10px]">
          {METRICS.map((m) => {
            const earned = points ? Math.max(0, Math.min(m.max, points[m.key] ?? 0)) : null;
            const pct = earned === null ? 0 : (earned / m.max) * 100;
            return (
              <div key={m.key}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-foreground">
                    {m[lang].label}
                  </span>
                  <span className="text-[12px] font-bold text-foreground">
                    {earned === null ? "—" : Math.round(earned * 10) / 10}
                    <span className="text-muted-foreground font-normal"> / {m.max}</span>
                  </span>
                </div>
                <div className="h-[6px] rounded-full bg-muted mt-[3px] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--gold-light)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground mt-[2px]">{m[lang].how}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Wings calc */}
      {p && (
        <div className="bg-[var(--ink)] text-white rounded-[16px] p-[15px]">
          <div className="flex items-center gap-[8px]">
            <Feather className="w-[16px] h-[16px] text-[var(--gold-light)]" />
            <div className="font-display font-bold text-[15px]">{t.wingsTitle}</div>
          </div>
          <p className="text-[12px] text-white/60 mt-[4px]">{t.wingsSub}</p>
          <div className="grid grid-cols-2 gap-[8px] mt-[12px] text-[12.5px]">
            <div className="bg-white/10 rounded-[10px] p-[9px]">
              <div className="text-white/60">{t.role}</div>
              <div className="font-bold">
                {roleInfo ? roleInfo[lang].toUpperCase() : "—"} · {p.baseWings}
              </div>
            </div>
            <div className="bg-white/10 rounded-[10px] p-[9px]">
              <div className="text-white/60">{t.founder}</div>
              <div className="font-bold">+{p.founderBonus}</div>
            </div>
            <div className="bg-white/10 rounded-[10px] p-[9px]">
              <div className="text-white/60">{t.yearsHere}</div>
              <div className="font-bold">
                {p.years === null ? t.notSet : `${p.years} ${t.yrs}`} · ×{p.yearsMultiplier.toFixed(2)}
              </div>
            </div>
            <div className="bg-white/10 rounded-[10px] p-[9px]">
              <div className="text-white/60">{t.scoreMult}</div>
              <div className="font-bold">
                {Math.round(wings.haloScore)} · ×{p.scoreMultiplier.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="mt-[12px] text-center">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--gold-light)] font-bold">
              {t.yourWings}
            </div>
            <div className="font-display font-bold text-[40px] leading-none mt-[4px]">
              {p.wings.toLocaleString()}
            </div>
            <div className="text-[11px] text-white/50 mt-[4px]">{t.formula}</div>
          </div>
          <div className="mt-[10px] space-y-[6px]">
            {p.blockers.length === 0 ? (
              <div className="text-[12px] text-[var(--gold-light)] flex items-start gap-[6px]">
                <Info className="w-[13px] h-[13px] mt-[1px] shrink-0" /> {t.eligible}
              </div>
            ) : (
              p.blockers.map((b) => (
                <div key={b} className="text-[12px] text-amber-300 flex items-start gap-[6px]">
                  <Info className="w-[13px] h-[13px] mt-[1px] shrink-0" />
                  {t.blockers[b as keyof typeof t.blockers]}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pot + fairness + bands */}
      <div className={card}>
        <div className="flex items-center gap-[8px] mb-[4px]">
          <Coins className="w-[16px] h-[16px] text-[var(--gold-dark)]" />
          <div className="font-display font-bold text-[15px]">{t.potTitle}</div>
        </div>
        <p className="text-[13px] text-muted-foreground">{t.potBody}</p>
        <div className="mt-[10px] rounded-[12px] border border-border bg-transparent p-[10px]">
          <div className="font-bold text-[12.5px] mb-[2px] text-foreground">{t.fairTitle}</div>
          <p className="text-[12.5px] text-muted-foreground">{t.fairBody}</p>
        </div>
        <div className="mt-[10px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-[5px]">
            {t.scoreBandsTitle}
          </div>
          <div className="space-y-[3px]">
            {SCORE_BANDS.map((b) => (
              <div key={b.range} className="flex justify-between text-[12.5px]">
                <span className="text-foreground">{b.range}</span>
                <span className="font-bold text-foreground">{b.mult}</span>
              </div>
            ))}
            <div className="flex justify-between text-[12.5px] text-muted-foreground">
              <span>{t.under60}</span>
              <span className="font-bold">× 0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className={card}>
        <div className="font-display font-bold text-[15px] mb-[6px]">{t.rulesTitle}</div>
        <ul className="space-y-[5px]">
          {t.rules.map((r, i) => (
            <li key={i} className="text-[12.5px] text-muted-foreground flex gap-[7px]">
              <span className="text-[var(--gold-dark)] font-bold">•</span> {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
