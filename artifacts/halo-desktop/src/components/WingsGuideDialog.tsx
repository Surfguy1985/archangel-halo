/**
 * WingsGuideDialog — desktop dialog version of the Archangel Wings Program
 * guide. Content mirrors the printed "Archangel Wings Program — Quarterly
 * Profit Sharing" document exactly.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Feather } from "lucide-react";

export type GuideLang = "en" | "es";

const COPY = {
  en: {
    heading: "Archangel Wings Program",
    subheading: "Quarterly Profit Sharing",
    intro:
      "Every quarter, after the bills are paid, Archangel puts 12% of the company's profit into one pot. That pot is split among the crew. This is not a raise and not a handout — it is a share of what we all built that quarter. The better you work, the more responsibility you carry, and the longer you stay, the bigger your slice.",

    s1Title: "1  How Your Slice Is Measured — Wings",
    s1Lead:
      "Nobody gets a fixed percentage. You earn Wings. At the end of the quarter we add up everyone's Wings, divide the pot by that total, and that tells us what one Wing is worth. Your check is simply your Wings × the value of a Wing.",
    formulaLabel: "Wings = ( Role + Founder Bonus ) × Years Here × Accountability Score",

    roleTitle: "A. Your Role → Base Wings",
    roleRows: [
      { label: "Crew member", val: "10" },
      { label: "Lead hand / senior crew", val: "15" },
      { label: "Foreman", val: "25" },
      { label: "Superintendent / office", val: "35" },
      { label: "Founding member bonus", val: "+15" },
    ],
    roleNote: "Founder bonus stacks on top of your role and is locked to the original crew list.",

    yearsTitle: "B. Your Years → Multiplier",
    yearsRows: [
      { label: "Under 1 year", val: "not eligible" },
      { label: "1 – 2 years", val: "× 1.00" },
      { label: "2 – 4 years", val: "× 1.15" },
      { label: "4 – 7 years", val: "× 1.30" },
      { label: "7+ years", val: "× 1.50" },
    ],
    yearsNote: "You must be here one full year before you share in the pot. Year one, you learn the job.",

    scoreTitle: "C. Your Score → Multiplier",
    scoreRows: [
      { label: "95 – 100", val: "× 1.30" },
      { label: "90 – 94", val: "× 1.15" },
      { label: "80 – 89", val: "× 1.00" },
      { label: "70 – 79", val: "× 0.80" },
      { label: "60 – 69", val: "× 0.50" },
      { label: "Under 60", val: "× 0 — no share" },
    ],
    scoreNote: "Your score is live in the app every day: safety, on time, closing out your work, photos & logs, customer feedback.",

    s2Title: "2  What a Real Quarter Looks Like",
    s2Lead: "Say the company clears $200,000 in profit. 12% = $24,000 pot. Here is how seven people split it:",
    exampleCols: ["Crew", "Role", "Yrs", "Score", "Wings", "Check"],
    exampleRows: [
      { crew: "Marcus", role: "Founding Supt", yrs: "6", score: "92", wings: "74.8", check: "$9,473" },
      { crew: "Danny", role: "Founding Foreman", yrs: "6", score: "85", wings: "52.0", check: "$6,590" },
      { crew: "Rosa", role: "Foreman", yrs: "3", score: "96", wings: "37.4", check: "$4,736" },
      { crew: "Tyrell", role: "Lead hand", yrs: "2.5", score: "88", wings: "17.3", check: "$2,186" },
      { crew: "Kev", role: "Crew member", yrs: "1.5", score: "74", wings: "8.0", check: "$1,014" },
      { crew: "Andre", role: "Crew member", yrs: "2", score: "58", wings: "—", check: "$0", dim: true },
      { crew: "Sam", role: "Crew member", yrs: "0.6", score: "91", wings: "—", check: "$0", dim: true },
    ],
    exampleNote: "Total Wings: 189.4  →  $24,000 ÷ 189.4 = One Wing = $126.73",
    mutualNote:
      "Andre's 58 cost him his whole share, and his Wings left the pile. With fewer Wings splitting the same pot, every Wing got worth about 6% more. Rosa's check went up because Andre didn't do his part. We carry each other, and we get paid for it.",

    s3Title: "3  What This Can Grow Into — Kev's Road",
    growthRows: [
      { move: "Today — crew, 1.5 yrs, score 74", wings: "8.0", check: "$1,014" },
      { move: "Same job, pulls score up to 90", wings: "11.5", check: "$1,458" },
      { move: "Hits 2.5 years, holds a 90", wings: "13.2", check: "$1,676" },
      { move: "Made lead hand, 3 yrs, score 92", wings: "19.8", check: "$2,514" },
      { move: "Made foreman, 5 yrs, score 95", wings: "42.3", check: "$5,354" },
    ],
    growthNote: "Same man, same company — 5× the check, just from showing up, scoring well, and taking on more.",

    s4Title: "4  The Rules, Plain and Short",
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
    footer: "Questions about your score or your Wings? Talk to your foreman first, then the office.",
  },

  es: {
    heading: "Programa Wings de Archangel",
    subheading: "Participación Trimestral en Ganancias",
    intro:
      "Cada trimestre, después de pagar las cuentas, Archangel pone el 12% de las ganancias de la empresa en un fondo. Ese fondo se divide entre la cuadrilla. No es un aumento y no es un regalo — es una parte de lo que todos construimos ese trimestre.",

    s1Title: "1  Cómo Se Mide Tu Parte — Wings",
    s1Lead:
      "Nadie recibe un porcentaje fijo. Ganas Wings. Al final del trimestre sumamos las Wings de todos, dividimos el fondo entre ese total y eso dice cuánto vale una Wing. Tu cheque es tus Wings × ese valor.",
    formulaLabel: "Wings = ( Rol + Bono Fundador ) × Años Aquí × Puntaje de Responsabilidad",

    roleTitle: "A. Tu Rol → Wings Base",
    roleRows: [
      { label: "Miembro de cuadrilla", val: "10" },
      { label: "Mano líder / cuadrilla senior", val: "15" },
      { label: "Capataz", val: "25" },
      { label: "Superintendente / oficina", val: "35" },
      { label: "Bono de miembro fundador", val: "+15" },
    ],
    roleNote: "El bono de fundador se suma al rol y está vinculado a la lista original de la cuadrilla.",

    yearsTitle: "B. Tus Años → Multiplicador",
    yearsRows: [
      { label: "Menos de 1 año", val: "no elegible" },
      { label: "1 – 2 años", val: "× 1.00" },
      { label: "2 – 4 años", val: "× 1.15" },
      { label: "4 – 7 años", val: "× 1.30" },
      { label: "7+ años", val: "× 1.50" },
    ],
    yearsNote: "Debes llevar un año completo antes de participar en el fondo. El primer año, aprendes el oficio.",

    scoreTitle: "C. Tu Puntaje → Multiplicador",
    scoreRows: [
      { label: "95 – 100", val: "× 1.30" },
      { label: "90 – 94", val: "× 1.15" },
      { label: "80 – 89", val: "× 1.00" },
      { label: "70 – 79", val: "× 0.80" },
      { label: "60 – 69", val: "× 0.50" },
      { label: "Menos de 60", val: "× 0 — sin parte" },
    ],
    scoreNote: "Tu puntaje está vivo en la app todos los días: seguridad, puntualidad, cerrar tu trabajo, fotos y registros, retroalimentación del cliente.",

    s2Title: "2  Cómo Se Ve Un Trimestre Real",
    s2Lead: "Supón que la empresa gana $200,000 en el trimestre. El 12% = $24,000 de fondo. Así lo dividen siete personas:",
    exampleCols: ["Cuadrilla", "Rol", "Años", "Puntaje", "Wings", "Cheque"],
    exampleRows: [
      { crew: "Marcus", role: "Supt. Fundador", yrs: "6", score: "92", wings: "74.8", check: "$9,473" },
      { crew: "Danny", role: "Cap. Fundador", yrs: "6", score: "85", wings: "52.0", check: "$6,590" },
      { crew: "Rosa", role: "Capataz", yrs: "3", score: "96", wings: "37.4", check: "$4,736" },
      { crew: "Tyrell", role: "Mano líder", yrs: "2.5", score: "88", wings: "17.3", check: "$2,186" },
      { crew: "Kev", role: "Miembro", yrs: "1.5", score: "74", wings: "8.0", check: "$1,014" },
      { crew: "Andre", role: "Miembro", yrs: "2", score: "58", wings: "—", check: "$0", dim: true },
      { crew: "Sam", role: "Miembro", yrs: "0.6", score: "91", wings: "—", check: "$0", dim: true },
    ],
    exampleNote: "Total Wings: 189.4  →  $24,000 ÷ 189.4 = Una Wing = $126.73",
    mutualNote:
      "El 58 de Andre le costó toda su parte y sus Wings salieron del fondo. Con menos Wings dividiendo el mismo fondo, cada Wing valió un 6% más. El cheque de Rosa subió porque Andre no cumplió. Nos cargamos mutuamente, y nos pagan por eso.",

    s3Title: "3  En Qué Puede Crecer — El Camino de Kev",
    growthRows: [
      { move: "Hoy — miembro, 1.5 años, puntaje 74", wings: "8.0", check: "$1,014" },
      { move: "Mismo trabajo, sube puntaje a 90", wings: "11.5", check: "$1,458" },
      { move: "Llega a 2.5 años, mantiene 90", wings: "13.2", check: "$1,676" },
      { move: "Mano líder, 3 años, puntaje 92", wings: "19.8", check: "$2,514" },
      { move: "Capataz, 5 años, puntaje 95", wings: "42.3", check: "$5,354" },
    ],
    growthNote: "El mismo hombre, la misma empresa — 5 veces el cheque, solo por presentarse, puntuar bien y asumir más.",

    s4Title: "4  Las Reglas, Claras y Cortas",
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
    footer: "¿Preguntas sobre tu puntaje o tus Wings? Habla primero con tu capataz, luego con la oficina.",
  },
} as const;

// ─── Shared sub-components ─────────────────────────────────────────────────────

function SimpleTable({
  rows,
  dimLast,
}: {
  rows: ReadonlyArray<{ readonly label: string; readonly val: string; readonly dim?: boolean }>;
  dimLast?: boolean;
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.label}
            className={`border-b border-border last:border-0 ${
              r.dim || (dimLast && i === rows.length - 1) ? "opacity-40" : ""
            }`}
          >
            <td className="py-1.5 pr-3 text-muted-foreground">{r.label}</td>
            <td className="py-1.5 text-right font-bold text-foreground">{r.val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WingsGuideContent({ lang }: { lang: GuideLang }) {
  const t = COPY[lang];
  const block = "space-y-2";
  const h3 = "font-display font-bold text-sm text-[var(--ink)]";
  const note = "text-xs text-muted-foreground";

  return (
    <div className="space-y-5 text-sm">
      <p className="text-muted-foreground leading-relaxed">{t.intro}</p>

      {/* Section 1 */}
      <div className={block}>
        <h3 className={h3}>{t.s1Title}</h3>
        <p className="text-muted-foreground leading-relaxed">{t.s1Lead}</p>
        <div className="bg-[var(--ink)] text-[var(--gold-light)] rounded-lg px-3 py-2 text-xs font-bold text-center">
          {t.formulaLabel}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Role */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">{t.roleTitle}</div>
            <SimpleTable rows={t.roleRows} />
            <p className={`${note} mt-1`}>{t.roleNote}</p>
          </div>
          {/* Years */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">{t.yearsTitle}</div>
            <SimpleTable rows={t.yearsRows} dimLast={false} />
            <p className={`${note} mt-1`}>{t.yearsNote}</p>
          </div>
          {/* Score */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">{t.scoreTitle}</div>
            <SimpleTable rows={t.scoreRows} />
            <p className={`${note} mt-1`}>{t.scoreNote}</p>
          </div>
        </div>
      </div>

      {/* Section 2 */}
      <div className={block}>
        <h3 className={h3}>{t.s2Title}</h3>
        <p className="text-muted-foreground leading-relaxed">{t.s2Lead}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-border">
                {t.exampleCols.map((c, i) => (
                  <th
                    key={c}
                    className={`py-1.5 px-2 font-bold text-muted-foreground uppercase tracking-wider ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.exampleRows.map((r) => (
                <tr
                  key={r.crew}
                  className={`border-b border-border/40 last:border-0 ${"dim" in r && r.dim ? "opacity-35" : ""}`}
                >
                  <td className="py-1.5 px-2 font-semibold">{r.crew}</td>
                  <td className="py-1.5 px-2 text-right text-muted-foreground">{r.role}</td>
                  <td className="py-1.5 px-2 text-right">{r.yrs}</td>
                  <td className="py-1.5 px-2 text-right">{r.score}</td>
                  <td className="py-1.5 px-2 text-right font-bold">{r.wings}</td>
                  <td className="py-1.5 px-2 text-right font-bold">{r.check}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${note} font-bold`}>{t.exampleNote}</p>
        <p className={`${note} italic`}>{t.mutualNote}</p>
      </div>

      {/* Section 3 */}
      <div className={block}>
        <h3 className={h3}>{t.s3Title}</h3>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="py-1.5 pr-3 text-left font-bold text-muted-foreground uppercase tracking-wider">Move</th>
              <th className="py-1.5 px-2 text-right font-bold text-muted-foreground uppercase tracking-wider">Wings</th>
              <th className="py-1.5 text-right font-bold text-muted-foreground uppercase tracking-wider">Check</th>
            </tr>
          </thead>
          <tbody>
            {t.growthRows.map((r, i) => (
              <tr key={r.move} className={`border-b border-border/40 last:border-0 ${i === 0 ? "opacity-50" : ""}`}>
                <td className="py-1.5 pr-3">{r.move}</td>
                <td className="py-1.5 px-2 text-right font-bold">{r.wings}</td>
                <td className="py-1.5 text-right font-bold text-[var(--gold-dark)]">{r.check}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`${note} italic`}>{t.growthNote}</p>
      </div>

      {/* Section 4 */}
      <div className={block}>
        <h3 className={h3}>{t.s4Title}</h3>
        <ol className="space-y-2 list-none">
          {t.rules.map((rule, i) => (
            <li key={i} className="flex gap-2.5 text-muted-foreground">
              <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--ink)] text-[var(--gold-light)] text-[10px] font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="leading-snug">{rule}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className={`${note} italic`}>{t.footer}</p>
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
          type="button"
          onClick={() => onChange(l)}
          data-testid={`button-guide-lang-${l}`}
          className={`px-3 py-1.5 transition-colors ${
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
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto border-none shadow-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 font-display">
              <Feather className="w-5 h-5 text-[var(--primary)]" />
              {COPY[lang].heading}
            </DialogTitle>
            <LangToggle lang={lang} onChange={setLang} />
          </div>
        </DialogHeader>
        <WingsGuideContent lang={lang} />
      </DialogContent>
    </Dialog>
  );
}
