/**
 * WingsGuide — bilingual crew-facing explainer that mirrors the printed
 * "Archangel Wings Program — Quarterly Profit Sharing" document exactly.
 *
 * Four sections (matching the PDF):
 *  1. How your slice is measured (formula + 3 tables)
 *  2. What a real quarter looks like (7-person example)
 *  3. What this can grow into (Kev's road)
 *  4. The rules, plain and short
 */

export type WingsGuideLang = "en" | "es";

// ─── Tier badge (used by the Wings tab score header) ──────────────────────────

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

// ─── Guide content ────────────────────────────────────────────────────────────

const COPY = {
  en: {
    heading: "Archangel Wings Program",
    subheading: "Quarterly Profit Sharing",
    intro:
      "Every quarter, after the bills are paid, Archangel puts 12% of the company's profit into one pot. That pot is split among the crew. This is not a raise and not a handout — it is a share of what we all built that quarter. The better you work, the more responsibility you carry, and the longer you stay, the bigger your slice.",

    // ── Section 1 ──
    s1Title: "1  How Your Slice Is Measured — Wings",
    s1Lead:
      "Nobody gets a fixed percentage. You earn Wings. At the end of the quarter we add up everyone's Wings, divide the pot by that total, and that tells us what one Wing is worth. Your check is simply your Wings × the value of a Wing.",
    formulaLabel: "Your Wings  =  ( Your Role  +  Founder Bonus )  ×  Years Here  ×  Accountability Score",

    roleTitle: "A. Your Role → Base Wings",
    roleRows: [
      { label: "Crew member", wings: "10" },
      { label: "Lead hand / senior crew", wings: "15" },
      { label: "Foreman", wings: "25" },
      { label: "Superintendent / office", wings: "35" },
      { label: "Founding member bonus", wings: "+15", note: "Stacks on top of your role, locked to the original crew list." },
    ],

    yearsTitle: "B. Your Years → Multiplier",
    yearsRows: [
      { label: "Under 1 year", mult: "not eligible" },
      { label: "1 – 2 years", mult: "× 1.00" },
      { label: "2 – 4 years", mult: "× 1.15" },
      { label: "4 – 7 years", mult: "× 1.30" },
      { label: "7+ years", mult: "× 1.50" },
    ],
    yearsNote: "You must be here one full year before you share in the pot. Year one, you learn the job.",

    scoreTitle: "C. Your Score → Multiplier",
    scoreRows: [
      { range: "95 – 100", mult: "× 1.30" },
      { range: "90 – 94", mult: "× 1.15" },
      { range: "80 – 89", mult: "× 1.00" },
      { range: "70 – 79", mult: "× 0.80" },
      { range: "60 – 69", mult: "× 0.50" },
      { range: "Under 60", mult: "× 0 — no share" },
    ],
    scoreNote: "Your score is live in the app every day: safety, on time, closing out your work, photos & logs, customer feedback.",

    // ── Section 2 ──
    s2Title: "2  What a Real Quarter Looks Like",
    s2Lead:
      "Say the company clears $200,000 in profit for the quarter. 12% of that is a $24,000 pot. Here is how seven people would split it:",
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
    exampleTotals: "Total Wings in the pile: 189.4  →  $24,000 ÷ 189.4",
    exampleWingValue: "One Wing = $126.73",
    examplePot: "$24,000",
    mutualNote:
      "THIS IS WHY IT'S CALLED MUTUAL — Andre's 58 cost him his whole share, and his Wings left the pile. With fewer Wings splitting the same pot, every single Wing got worth about 6% more. Rosa's check went up because Andre didn't do his part. It works the other way too: when Andre picks it up, the pot he helps earn gets bigger for all of us. We carry each other, and we get paid for it.",

    // ── Section 3 ──
    s3Title: "3  What This Can Grow Into",
    s3Lead:
      "Kev is at $1,014 today. Nothing about that is fixed — here is his road, at a similar sized pot:",
    growthCols: ["Kev's next moves", "Wings", "His check"],
    growthRows: [
      { move: "Today — crew, 1.5 yrs, score 74", wings: "8.0", check: "$1,014" },
      { move: "Same job, pulls score up to 90", wings: "11.5", check: "$1,458" },
      { move: "Hits 2.5 years, holds a 90", wings: "13.2", check: "$1,676" },
      { move: "Made lead hand, 3 yrs, score 92", wings: "19.8", check: "$2,514" },
      { move: "Made foreman, 5 yrs, score 95", wings: "42.3", check: "$5,354" },
    ],
    growthNote: "Same man, same company — 5× the check, just from showing up, scoring well, and taking on more.",

    // ── Section 4 ──
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
    footer:
      "Questions about your score or your Wings? Talk to your foreman first, then the office. Every point is traceable to a record.",
  },

  es: {
    heading: "Programa Wings de Archangel",
    subheading: "Participación Trimestral en Ganancias",
    intro:
      "Cada trimestre, después de pagar las cuentas, Archangel pone el 12% de las ganancias de la empresa en un fondo. Ese fondo se divide entre la cuadrilla. No es un aumento y no es un regalo — es una parte de lo que todos construimos ese trimestre. Cuanto mejor trabajas, más responsabilidad llevas y más tiempo llevas aquí, más grande es tu parte.",

    s1Title: "1  Cómo Se Mide Tu Parte — Wings",
    s1Lead:
      "Nadie recibe un porcentaje fijo. Ganas Wings. Al final del trimestre sumamos las Wings de todos, dividimos el fondo entre ese total y eso nos dice cuánto vale una Wing. Tu cheque es simplemente tus Wings × el valor de una Wing.",
    formulaLabel: "Tus Wings  =  ( Tu Rol  +  Bono de Fundador )  ×  Años Aquí  ×  Puntaje de Responsabilidad",

    roleTitle: "A. Tu Rol → Wings Base",
    roleRows: [
      { label: "Miembro de cuadrilla", wings: "10" },
      { label: "Mano líder / cuadrilla senior", wings: "15" },
      { label: "Capataz", wings: "25" },
      { label: "Superintendente / oficina", wings: "35" },
      { label: "Bono de miembro fundador", wings: "+15", note: "Se suma al rol, vinculado a la lista original." },
    ],

    yearsTitle: "B. Tus Años → Multiplicador",
    yearsRows: [
      { label: "Menos de 1 año", mult: "no elegible" },
      { label: "1 – 2 años", mult: "× 1.00" },
      { label: "2 – 4 años", mult: "× 1.15" },
      { label: "4 – 7 años", mult: "× 1.30" },
      { label: "7+ años", mult: "× 1.50" },
    ],
    yearsNote: "Debes llevar un año completo antes de participar en el fondo. El primer año, aprendes el oficio.",

    scoreTitle: "C. Tu Puntaje → Multiplicador",
    scoreRows: [
      { range: "95 – 100", mult: "× 1.30" },
      { range: "90 – 94", mult: "× 1.15" },
      { range: "80 – 89", mult: "× 1.00" },
      { range: "70 – 79", mult: "× 0.80" },
      { range: "60 – 69", mult: "× 0.50" },
      { range: "Menos de 60", mult: "× 0 — sin parte" },
    ],
    scoreNote: "Tu puntaje está vivo en la app todos los días: seguridad, puntualidad, cerrar tu trabajo, fotos y registros, retroalimentación del cliente.",

    s2Title: "2  Cómo Se Ve Un Trimestre Real",
    s2Lead:
      "Supón que la empresa gana $200,000 en el trimestre. El 12% de eso es un fondo de $24,000. Así lo dividirían siete personas:",
    exampleCols: ["Cuadrilla", "Rol", "Años", "Puntaje", "Wings", "Cheque"],
    exampleRows: [
      { crew: "Marcus", role: "Supt Fundador", yrs: "6", score: "92", wings: "74.8", check: "$9,473" },
      { crew: "Danny", role: "Cap. Fundador", yrs: "6", score: "85", wings: "52.0", check: "$6,590" },
      { crew: "Rosa", role: "Capataz", yrs: "3", score: "96", wings: "37.4", check: "$4,736" },
      { crew: "Tyrell", role: "Mano líder", yrs: "2.5", score: "88", wings: "17.3", check: "$2,186" },
      { crew: "Kev", role: "Miembro", yrs: "1.5", score: "74", wings: "8.0", check: "$1,014" },
      { crew: "Andre", role: "Miembro", yrs: "2", score: "58", wings: "—", check: "$0", dim: true },
      { crew: "Sam", role: "Miembro", yrs: "0.6", score: "91", wings: "—", check: "$0", dim: true },
    ],
    exampleTotals: "Total Wings en el fondo: 189.4  →  $24,000 ÷ 189.4",
    exampleWingValue: "Una Wing = $126.73",
    examplePot: "$24,000",
    mutualNote:
      "POR ESTO SE LLAMA MUTUO — El 58 de Andre le costó toda su parte, y sus Wings salieron del fondo. Con menos Wings dividiendo el mismo fondo, cada Wing valió un 6% más. El cheque de Rosa subió porque Andre no cumplió. También funciona al revés: cuando Andre sube, el fondo que ayuda a ganar crece para todos. Nos cargamos mutuamente, y nos pagan por eso.",

    s3Title: "3  En Qué Puede Crecer",
    s3Lead:
      "Kev está en $1,014 hoy. Nada de eso está fijo — aquí está su camino, con un fondo similar:",
    growthCols: ["Los próximos pasos de Kev", "Wings", "Su cheque"],
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
    footer:
      "¿Preguntas sobre tu puntaje o tus Wings? Habla primero con tu capataz, luego con la oficina. Cada punto tiene un registro.",
  },
} as const;

// ─── Helper tables ─────────────────────────────────────────────────────────────

function TableRow({
  cols,
  bold,
  dim,
  highlight,
}: {
  cols: string[];
  bold?: boolean;
  dim?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr
      className={`border-b border-border/50 last:border-0 ${
        highlight ? "bg-[var(--gold-light)]/10" : ""
      } ${dim ? "opacity-40" : ""}`}
    >
      {cols.map((c, i) => (
        <td
          key={i}
          className={`py-[6px] px-[8px] text-[12px] ${
            i === 0 ? "text-left" : "text-right"
          } ${bold || i > 0 ? "font-bold" : ""} text-foreground`}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function WingsGuide({
  lang,
  onLangChange,
}: {
  lang: WingsGuideLang;
  onLangChange: (l: WingsGuideLang) => void;
}) {
  const t = COPY[lang];

  const sectionCard = "bg-card rounded-[14px] border border-border p-[14px] space-y-[10px]";
  const miniTable = "w-full border-collapse rounded-[10px] overflow-hidden border border-border";
  const sectionNum = "text-[var(--gold-dark)] font-display font-bold text-[15px]";

  return (
    <div className="space-y-[14px]" data-testid="wings-guide">
      {/* Lang toggle + heading */}
      <div className="flex items-start justify-between gap-[10px]">
        <div>
          <h2 className="font-display font-bold text-[18px] tracking-[-0.01em] leading-tight">
            {t.heading}
          </h2>
          <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--gold-dark)] mt-[2px]">
            {t.subheading}
          </div>
        </div>
        <div className="flex rounded-[10px] overflow-hidden border border-border shrink-0">
          {(["en", "es"] as WingsGuideLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLangChange(l)}
              data-testid={`wings-guide-lang-${l}`}
              className={`px-[12px] py-[6px] text-[12px] font-display font-bold ${
                lang === l ? "bg-[var(--ink)] text-white" : "bg-card text-muted-foreground"
              }`}
            >
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground leading-relaxed">{t.intro}</p>

      {/* ── Section 1: How it's measured ── */}
      <div className={sectionCard}>
        <div className={sectionNum}>{t.s1Title}</div>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">{t.s1Lead}</p>
        <div className="bg-[var(--ink)] text-[var(--gold-light)] rounded-[10px] px-[12px] py-[10px] text-[11.5px] font-bold text-center leading-snug">
          {t.formulaLabel}
        </div>

        {/* Role table */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground mb-[5px]">
            {t.roleTitle}
          </div>
          <table className={miniTable}>
            <tbody>
              {t.roleRows.map((r) => (
                <TableRow
                  key={r.label}
                  cols={[r.label, r.wings]}
                  highlight={"note" in r}
                />
              ))}
            </tbody>
          </table>
          {"note" in t.roleRows[t.roleRows.length - 1] && (
            <p className="text-[11px] text-muted-foreground mt-[5px]">
              {(t.roleRows[t.roleRows.length - 1] as any).note}
            </p>
          )}
        </div>

        {/* Years table */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground mb-[5px]">
            {t.yearsTitle}
          </div>
          <table className={miniTable}>
            <tbody>
              {t.yearsRows.map((r, i) => (
                <TableRow
                  key={r.label}
                  cols={[r.label, r.mult]}
                  dim={i === 0}
                />
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-[5px]">{t.yearsNote}</p>
        </div>

        {/* Score table */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground mb-[5px]">
            {t.scoreTitle}
          </div>
          <table className={miniTable}>
            <tbody>
              {t.scoreRows.map((r, i) => (
                <TableRow
                  key={r.range}
                  cols={[r.range, r.mult]}
                  dim={i === t.scoreRows.length - 1}
                />
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-[5px]">{t.scoreNote}</p>
        </div>
      </div>

      {/* ── Section 2: Example quarter ── */}
      <div className={sectionCard}>
        <div className={sectionNum}>{t.s2Title}</div>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">{t.s2Lead}</p>
        <div className="overflow-x-auto -mx-[4px]">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b-2 border-border">
                {t.exampleCols.map((c, i) => (
                  <th
                    key={c}
                    className={`py-[5px] px-[6px] font-bold text-muted-foreground uppercase tracking-[0.05em] text-[10px] ${
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
                  <td className="py-[6px] px-[6px] font-semibold text-foreground">{r.crew}</td>
                  <td className="py-[6px] px-[6px] text-right text-muted-foreground">{r.role}</td>
                  <td className="py-[6px] px-[6px] text-right text-foreground">{r.yrs}</td>
                  <td className="py-[6px] px-[6px] text-right text-foreground">{r.score}</td>
                  <td className="py-[6px] px-[6px] text-right font-bold text-foreground">{r.wings}</td>
                  <td className="py-[6px] px-[6px] text-right font-bold text-foreground">{r.check}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-muted rounded-[10px] px-[12px] py-[10px] space-y-[4px] text-center">
          <div className="text-[11.5px] text-muted-foreground">{t.exampleTotals}</div>
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-foreground">{t.exampleWingValue}</span>
            <span className="text-[13px] font-display font-bold text-[var(--gold-dark)]">{t.examplePot}</span>
          </div>
        </div>
        <p className="text-[11.5px] text-muted-foreground italic leading-relaxed">{t.mutualNote}</p>
      </div>

      {/* ── Section 3: Growth path ── */}
      <div className={sectionCard}>
        <div className={sectionNum}>{t.s3Title}</div>
        <p className="text-[12.5px] text-muted-foreground leading-relaxed">{t.s3Lead}</p>
        <table className={miniTable}>
          <thead>
            <tr className="border-b-2 border-border">
              {t.growthCols.map((c, i) => (
                <th
                  key={c}
                  className={`py-[5px] px-[8px] font-bold text-muted-foreground uppercase tracking-[0.05em] text-[10px] ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.growthRows.map((r, i) => (
              <tr
                key={r.move}
                className={`border-b border-border/40 last:border-0 ${i === 0 ? "opacity-50" : ""}`}
              >
                <td className="py-[6px] px-[8px] text-[12px] text-foreground">{r.move}</td>
                <td className="py-[6px] px-[8px] text-right font-bold text-[12px] text-foreground">{r.wings}</td>
                <td className="py-[6px] px-[8px] text-right font-bold text-[12px] text-[var(--gold-dark)]">{r.check}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11.5px] text-muted-foreground italic">{t.growthNote}</p>
      </div>

      {/* ── Section 4: Rules ── */}
      <div className={sectionCard}>
        <div className={sectionNum}>{t.s4Title}</div>
        <ol className="space-y-[8px] list-none">
          {t.rules.map((rule, i) => (
            <li key={i} className="flex items-start gap-[8px]">
              <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-[var(--ink)] text-[var(--gold-light)] text-[10px] font-bold flex items-center justify-center mt-[1px]">
                {i + 1}
              </span>
              <span className="text-[12.5px] text-muted-foreground leading-snug">{rule}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[11.5px] text-muted-foreground leading-relaxed pt-[2px] italic">
        {t.footer}
      </p>
    </div>
  );
}
