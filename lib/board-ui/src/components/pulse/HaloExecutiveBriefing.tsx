/**
 * Executive Briefing — the boardroom read of every live HALO module.
 *
 * The desk panels are a working surface: dense, scrollable, built for one
 * operator leaning in. A board meeting is the opposite room, so this is a
 * full-screen deck — one question per slide, one number big enough to read
 * from the far end of the table, and the supporting detail underneath it.
 *
 * Everything on these slides is live: the deck pulls the same endpoints the
 * desks do and keeps polling while it is open, so a number quoted in the
 * meeting is the number the office is looking at. Nothing is seeded, mocked,
 * or frozen at open time.
 *
 * Where a figure genuinely has not been measured yet, the slide says so —
 * a zero on a boardroom screen reads as a measurement, and this deck should
 * never claim a measurement it doesn't have.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useGetPortfolioPulse,
  getGetPortfolioPulseQueryKey,
  useGetMoneySummary,
  getGetMoneySummaryQueryKey,
  useListJobs,
  getListJobsQueryKey,
  useListCrews,
  getListCrewsQueryKey,
  useListVendors,
  getListVendorsQueryKey,
  type Job,
  type CrewToday,
  type Vendor,
  type MoneySummary,
  type PortfolioPulseDocument,
} from "@workspace/api-client-react";
import { formatUsdCents } from "./formatUsdCents";
import "./haloExecutiveBriefing.css";

const POLL_MS = 30_000;
/** Long enough to make the point, short enough to keep a room moving. */
const ADVANCE_MS = 14_000;

export type HaloExecutiveBriefingProps = {
  /** Portfolio whose pulse the deck opens on. Empty = pulse slides are skipped. */
  portfolioId?: string;
  /** Shown on the cover. Falls back to the portfolio name. */
  companyName?: string;
  onClose: () => void;
};

/* ---------- formatting ------------------------------------------------- */

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

const days = (n: number | null | undefined) =>
  n == null ? null : `${n.toFixed(1)}d`;

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function clockLabel(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ---------- small pieces ----------------------------------------------- */

function Stat(props: {
  label: string;
  value: string | null;
  note?: string;
  tone?: "lime" | "warn" | "danger";
  /** Shown in place of the value when it hasn't been measured yet. */
  empty?: string;
}) {
  const missing = props.value == null;
  return (
    <div className="halo-brief-stat" data-tone={missing ? undefined : props.tone}>
      <b className={missing ? "nodata" : undefined}>{props.value ?? props.empty ?? "No data yet"}</b>
      <span>{props.label}</span>
      {props.note ? <em>{props.note}</em> : null}
    </div>
  );
}

function Rows(props: { children: React.ReactNode; empty: string; count: number }) {
  if (props.count === 0) return <p className="halo-brief-empty">{props.empty}</p>;
  return <div className="halo-brief-rows">{props.children}</div>;
}

/* ---------- slide builders ---------------------------------------------- */

type Slide = { id: string; step: string; body: React.ReactNode };

/**
 * A slide whose figures haven't arrived yet. It says so plainly rather than
 * counting an empty array as a measured zero — "0 crews working" would be a
 * lie on a boardroom screen while the request is still in flight.
 */
function loadingSlide(id: string, step: string, what: string): Slide {
  return {
    id,
    step,
    body: (
      <>
        <p className="halo-brief-kicker">{step}</p>
        <h2 className="halo-brief-title">{what}</h2>
        <p className="halo-brief-empty">Live figures are still coming in.</p>
      </>
    ),
  };
}

function coverSlide(name: string, pulse: PortfolioPulseDocument | undefined): Slide {
  return {
    id: "cover",
    step: "Cover",
    body: (
      <>
        <p className="halo-brief-kicker">Executive briefing</p>
        <h1 className="halo-brief-title">{name}</h1>
        <p className="halo-brief-sub">
          {todayLabel()} · {pulse ? `${pulse.portfolioName} · ${pulse.range.replace(/_/g, " ")}` : "Live operations"}
        </p>
        <p className="halo-brief-heronote">
          Every number in this deck is read live from HALO as we speak. Use ← and → to move, space to
          pause, Esc to close.
        </p>
      </>
    ),
  };
}

function vacancySlide(pulse: PortfolioPulseDocument): Slide {
  const delta = pulse.headline.vacancyCostDeltaCents;
  const worse = !delta.startsWith("-") && delta !== "0";
  return {
    id: "vacancy",
    step: "Vacancy cost",
    body: (
      <>
        <p className="halo-brief-kicker">What empty homes are costing us</p>
        <h2 className="halo-brief-title">Vacancy cost, {pulse.headline.priorLabel ? "this period" : "to date"}</h2>
        <p className="halo-brief-hero">{formatUsdCents(pulse.headline.vacancyCostCents)}</p>
        <p className="halo-brief-heronote">
          {pulse.headline.label}.{" "}
          <span className={`halo-brief-delta ${worse ? "up" : "down"}`}>
            {worse ? "▲" : "▼"} {formatUsdCents(delta.replace(/^-/, ""))}
          </span>{" "}
          versus {pulse.headline.priorLabel || "the prior period"} ({formatUsdCents(pulse.headline.priorVacancyCostCents)}).
        </p>
        <div className="halo-brief-stats">
          <Stat label="Units in turn" value={String(pulse.supporting.unitsInTurn)} tone="lime" />
          <Stat
            label="Median turn"
            value={days(pulse.supporting.medianTurnDays)}
            note={`Target ${pulse.supporting.targetTurnDays}d`}
            tone={
              pulse.supporting.medianTurnDays != null &&
              pulse.supporting.medianTurnDays > pulse.supporting.targetTurnDays
                ? "warn"
                : "lime"
            }
            empty="No turns closed yet"
          />
          <Stat
            label="Predicted late this week"
            value={String(pulse.supporting.predictedLateThisWeek)}
            tone={pulse.supporting.predictedLateThisWeek > 0 ? "danger" : "lime"}
          />
          <Stat label="Communities" value={String(pulse.tiles.length)} />
        </div>
      </>
    ),
  };
}

function communitiesSlide(pulse: PortfolioPulseDocument): Slide {
  const tiles = [...pulse.tiles]
    .sort((a, b) => {
      try {
        const d = BigInt(b.vacancyCostCents) - BigInt(a.vacancyCostCents);
        if (d === 0n) return a.name.localeCompare(b.name);
        return d > 0n ? 1 : -1;
      } catch {
        return a.name.localeCompare(b.name);
      }
    })
    .slice(0, 7);
  return {
    id: "communities",
    step: "Communities",
    body: (
      <>
        <p className="halo-brief-kicker">Where the cost sits</p>
        <h2 className="halo-brief-title">Communities by vacancy cost</h2>
        <p className="halo-brief-sub">Highest cost first — this is the order the office works them in.</p>
        <Rows count={tiles.length} empty="No communities in this window yet.">
          {tiles.map((t) => (
            <div key={t.propertyId} className="halo-brief-row">
              <strong>{t.name}</strong>
              <em>{formatUsdCents(t.vacancyCostCents)}</em>
              <span>
                <span className="halo-brief-chip" data-tone={t.status}>
                  {t.statusLabel}
                </span>{" "}
                {t.unitsInTurn} in turn of {t.unitCount}
                {t.medianTurnDays != null ? ` · ${t.medianTurnDays.toFixed(1)}d median` : " · turn time not measured"}
              </span>
            </div>
          ))}
        </Rows>
      </>
    ),
  };
}

function moneySlide(money: MoneySummary | undefined): Slide {
  if (!money) return loadingSlide("money", "Cash", "Pulling the cash position…");
  const aging = money.aging ?? [];
  const agingMax = aging.reduce((m, b) => Math.max(m, b.value), 0);
  const tone = (label: string) =>
    label === "60+" ? "danger" : label === "31–60" ? "warn" : undefined;
  return {
    id: "money",
    step: "Cash",
    body: (
      <>
        <p className="halo-brief-kicker">Cash position</p>
        <h2 className="halo-brief-title">What is owed, and what landed</h2>
        <p className="halo-brief-hero">{usd(money.landing)}</p>
        <p className="halo-brief-heronote">
          Outstanding across every sent invoice
          {money.bankConnected ? " · cash figures come from the connected bank" : ""}.
        </p>
        <div className="halo-brief-stats">
          <Stat
            label="At risk (past due)"
            value={usd(money.atRisk)}
            tone={money.atRisk > 0 ? "danger" : "lime"}
          />
          <Stat label="Collected month to date" value={usd(money.collectedMtd ?? 0)} tone="lime" />
          <Stat
            label="Spent month to date"
            value={money.spentMtd == null ? null : usd(money.spentMtd)}
            empty="Connect a bank"
          />
          {/* The server returns 0% when nothing has been measured yet, so a flat
              zero here means "no margin recorded", not "we made nothing". */}
          <Stat
            label="Margin"
            value={money.marginPct > 0 ? `${money.marginPct.toFixed(1)}%` : null}
            tone={money.marginPct >= 25 ? "lime" : "warn"}
            note="25% is the floor"
            empty="No margin recorded yet"
          />
        </div>
        <div className="halo-brief-bars">
          {aging.map((bucket) => (
            <div key={bucket.label} className="halo-brief-bar" data-tone={tone(bucket.label)}>
              <b>{bucket.label}</b>
              <i>
                <u style={{ width: `${agingMax > 0 ? Math.max(2, (bucket.value / agingMax) * 100) : 0}%` }} />
              </i>
              <span>{usd(bucket.value)}</span>
            </div>
          ))}
        </div>
      </>
    ),
  };
}

/**
 * Job lifecycle, as the Job Board actually keeps it: `status` carries
 * open → scheduled → complete → paid (plus cancelled), while the crew-working
 * state lives on `boardStatus` ("filled"). A card leaves the board through
 * `clearedAt` or boardStatus "removed" — never through a status value.
 */
const isOffBoard = (j: Job) =>
  Boolean(j.clearedAt) || j.boardStatus === "removed" || j.status === "cancelled";

type WorkCounts = {
  working: number;
  waiting: number;
  done: number;
  paid: number;
  waitingPo: number;
  needCrew: number;
  onBoard: number;
};

function workCounts(jobs: Job[]): WorkCounts {
  const board = jobs.filter((j) => !isOffBoard(j));
  const done = board.filter((j) => j.status === "complete" || j.boardStatus === "completed");
  const paid = board.filter((j) => j.status === "paid");
  const working = board.filter((j) => j.boardStatus === "filled" && !done.includes(j) && !paid.includes(j));
  const settled = new Set([...done, ...paid, ...working]);
  return {
    working: working.length,
    waiting: board.filter((j) => !settled.has(j)).length,
    done: done.length,
    paid: paid.length,
    // A job cannot move to Billing without a client PO, so this is the queue
    // that will stall at the end of the month.
    waitingPo: board.filter((j) => j.status !== "paid" && !j.poNumber).length,
    needCrew: board.filter((j) => !j.crewLeaderId && !done.includes(j) && !paid.includes(j)).length,
    onBoard: board.length,
  };
}

function workSlide(jobs: Job[] | undefined): Slide {
  if (!jobs) return loadingSlide("work", "Work in flight", "Reading the job board…");
  const c = workCounts(jobs);
  const blocked = jobs
    .filter((j) => !isOffBoard(j) && j.status !== "paid" && (!j.poNumber || !j.crewLeaderId))
    .slice(0, 6);
  return {
    id: "work",
    step: "Work in flight",
    body: (
      <>
        <p className="halo-brief-kicker">Work in flight</p>
        <h2 className="halo-brief-title">{c.onBoard} jobs on the board</h2>
        <div className="halo-brief-stats">
          <Stat label="Crew assigned and working" value={String(c.working)} tone="lime" />
          <Stat label="Requested or scheduled" value={String(c.waiting)} />
          <Stat label="Finished, in billing" value={String(c.done)} />
          <Stat
            label="Waiting on a client PO"
            value={String(c.waitingPo)}
            tone={c.waitingPo > 0 ? "warn" : "lime"}
            note="A job can't be billed without one"
          />
          <Stat
            label="Still need a crew"
            value={String(c.needCrew)}
            tone={c.needCrew > 0 ? "danger" : "lime"}
          />
        </div>
        <Rows count={blocked.length} empty="Every live job has a PO and a crew.">
          {blocked.map((j) => (
            <div key={j.id} className="halo-brief-row">
              <strong>{j.unitNo ? `Unit ${j.unitNo}` : j.jobNo}</strong>
              <em className={j.poNumber ? "nodata" : undefined}>{j.poNumber ? "Needs crew" : "Needs PO"}</em>
              <span>
                {j.propertyName ?? "—"}
                {j.crewLeaderName ? ` · ${j.crewLeaderName}` : ""}
              </span>
            </div>
          ))}
        </Rows>
      </>
    ),
  };
}

function fieldSlide(crews: CrewToday[] | undefined): Slide {
  if (!crews) return loadingSlide("field", "The field", "Checking who is out today…");
  const active = crews.filter((c) => c.active !== false);
  const onSite = active.filter((c) => c.todayStatus === "site");
  const enRoute = active.filter((c) => c.todayStatus === "route");
  const done = active.filter((c) => c.todayStatus === "done");
  const working = [...onSite, ...enRoute].slice(0, 6);
  return {
    id: "field",
    step: "The field",
    body: (
      <>
        <p className="halo-brief-kicker">The field, right now</p>
        <h2 className="halo-brief-title">{onSite.length + enRoute.length} crews working today</h2>
        <div className="halo-brief-stats">
          <Stat label="On site" value={String(onSite.length)} tone="lime" />
          <Stat label="En route" value={String(enRoute.length)} />
          <Stat label="Finished today" value={String(done.length)} />
          <Stat label="Crews on the roster" value={String(active.length)} />
        </div>
        <Rows count={working.length} empty="No crew has checked in yet today.">
          {working.map((c) => (
            <div key={c.id} className="halo-brief-row">
              <strong>{c.name}</strong>
              <em>{c.todayStatus === "site" ? "On site" : "En route"}</em>
              <span>
                {c.todayProperty ?? "—"}
                {c.todayJob ? ` · ${c.todayJob}` : ""}
              </span>
            </div>
          ))}
        </Rows>
      </>
    ),
  };
}

function vendorSlide(vendors: Vendor[] | undefined): Slide {
  if (!vendors) return loadingSlide("vendors", "The bench", "Reading the vendor bench…");
  const contracted = vendors.filter((v) => v.contractStatus !== "inactive");
  const inHouse = contracted.find((v) => v.vendorType === "in_house");
  const subs = contracted.filter((v) => v.vendorType !== "in_house");
  const measured = subs
    .filter((v) => v.avgTurnDays != null)
    .sort((a, b) => (a.avgTurnDays ?? 0) - (b.avgTurnDays ?? 0))
    .slice(0, 5);
  const expiring = contracted.filter((v) => v.compliant === false).length;
  return {
    id: "vendors",
    step: "The bench",
    body: (
      <>
        <p className="halo-brief-kicker">Who turns our units</p>
        <h2 className="halo-brief-title">{contracted.length} contracted {contracted.length === 1 ? "vendor" : "vendors"}</h2>
        <div className="halo-brief-stats">
          <Stat
            label={inHouse ? `${inHouse.name} — average turn` : "Our own crews — average turn"}
            value={days(inHouse?.avgTurnDays)}
            note={inHouse?.avgTurnSamples ? `${inHouse.avgTurnSamples} jobs measured` : undefined}
            tone="lime"
          />
          <Stat label="Subcontractors on the bench" value={String(subs.length)} />
          <Stat
            label="Certificates expired or missing"
            value={String(expiring)}
            tone={expiring > 0 ? "danger" : "lime"}
          />
        </div>
        <Rows count={measured.length} empty="No subcontractor has a measured turn time yet.">
          {measured.map((v) => (
            <div key={v.id} className="halo-brief-row">
              <strong>{v.name}</strong>
              <em>{days(v.avgTurnDays)}</em>
              <span>
                {v.trade || "Subcontractor"} · {v.avgTurnSamples ?? 0} measured
                {v.avgPoDays != null ? ` · ${v.avgPoDays.toFixed(1)}d to receive a PO` : " · PO cycle not measured"}
              </span>
            </div>
          ))}
        </Rows>
      </>
    ),
  };
}

function closeSlide(args: {
  pulse: PortfolioPulseDocument | undefined;
  money: MoneySummary | undefined;
  jobs: Job[] | undefined;
  asOf: string;
}): Slide {
  const c = args.jobs ? workCounts(args.jobs) : undefined;
  return {
    id: "close",
    step: "The ask",
    body: (
      <>
        <p className="halo-brief-kicker">Where we need a decision</p>
        <h2 className="halo-brief-title">Three numbers to leave with</h2>
        <div className="halo-brief-stats">
          <Stat
            label="Vacancy cost this period"
            value={args.pulse ? formatUsdCents(args.pulse.headline.vacancyCostCents) : null}
            tone="lime"
          />
          <Stat
            label="Past due, at risk"
            value={args.money ? usd(args.money.atRisk) : null}
            tone={args.money && args.money.atRisk > 0 ? "danger" : "lime"}
          />
          <Stat
            label="Jobs blocked on a PO"
            value={c ? String(c.waitingPo) : null}
            tone={c && c.waitingPo > 0 ? "warn" : "lime"}
            empty="Still counting"
          />
        </div>
        <p className="halo-brief-heronote">Live from HALO as of {args.asOf}.</p>
      </>
    ),
  };
}

/* ---------- deck --------------------------------------------------------- */

export function HaloExecutiveBriefing(props: HaloExecutiveBriefingProps) {
  const { portfolioId = "", onClose } = props;
  // The presenter's place is held by slide id, never by position: the deck
  // grows when the portfolio pulse lands (two slides get inserted ahead of
  // Cash), and an index would silently point at a different slide.
  const [activeId, setActiveId] = useState("cover");
  const [playing, setPlaying] = useState(true);
  const [asOf, setAsOf] = useState(() => clockLabel());
  const stageRef = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(0);

  const pulseParams = { range: "this_month" as const };
  const { data: pulse } = useGetPortfolioPulse(portfolioId || "pending", pulseParams, {
    query: {
      enabled: Boolean(portfolioId),
      queryKey: getGetPortfolioPulseQueryKey(portfolioId || "pending", pulseParams),
      refetchInterval: POLL_MS,
    },
  });
  const { data: money } = useGetMoneySummary({
    query: { queryKey: getGetMoneySummaryQueryKey(), refetchInterval: POLL_MS },
  });
  const { data: jobs } = useListJobs(undefined, {
    query: { queryKey: getListJobsQueryKey(), refetchInterval: POLL_MS },
  });
  const { data: crews } = useListCrews({
    query: { queryKey: getListCrewsQueryKey(), refetchInterval: POLL_MS },
  });
  const { data: vendors } = useListVendors({
    query: { queryKey: getListVendorsQueryKey(), refetchInterval: POLL_MS },
  });

  useEffect(() => {
    const t = setInterval(() => setAsOf(clockLabel()), 60_000);
    return () => clearInterval(t);
  }, []);

  const slides = useMemo<Slide[]>(() => {
    const deck: Slide[] = [coverSlide(props.companyName || pulse?.portfolioName || "HALO", pulse)];
    if (pulse) {
      deck.push(vacancySlide(pulse), communitiesSlide(pulse));
    }
    deck.push(moneySlide(money), workSlide(jobs), fieldSlide(crews), vendorSlide(vendors));
    deck.push(closeSlide({ pulse, money, jobs, asOf }));
    return deck;
  }, [pulse, money, jobs, crews, vendors, asOf, props.companyName]);

  // If a slide ever disappears from under us, fall back to where the presenter
  // was standing rather than throwing the room back to the cover.
  const byId = slides.findIndex((s) => s.id === activeId);
  const safeIndex = byId >= 0 ? byId : Math.min(lastIndex.current, slides.length - 1);
  const current = slides[safeIndex];
  lastIndex.current = safeIndex;

  // Every navigation path — buttons, agenda rail, keyboard, auto-advance —
  // goes through here, so the deck only ever moves by choosing a slide id.
  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, next));
      const id = slides[clamped]?.id;
      if (id) setActiveId(id);
      stageRef.current?.scrollTo({ top: 0 });
    },
    [slides],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        go(safeIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(safeIndex - 1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Home") {
        go(0);
      } else if (e.key === "End") {
        go(slides.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, safeIndex, slides.length, onClose]);

  // Auto-advance holds on the closing slide: the deck should end on the ask,
  // not loop back to the cover while the room is still discussing it.
  useEffect(() => {
    if (!playing) return;
    if (safeIndex >= slides.length - 1) return;
    const t = setTimeout(() => go(safeIndex + 1), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [playing, safeIndex, slides.length, go]);

  return (
    <div className="halo-brief" role="dialog" aria-modal="true" aria-label="Executive briefing">
      <div className="halo-brief-top">
        <span className="halo-brief-mark">HALO · Executive briefing</span>
        <span className="halo-brief-live">
          <i />
          Live · {asOf}
        </span>
        <span className="halo-brief-spacer" />
        <span className="halo-brief-count">
          {safeIndex + 1} / {slides.length}
        </span>
        <button type="button" className="halo-brief-icon" onClick={() => go(safeIndex - 1)} disabled={safeIndex === 0}>
          Back
        </button>
        <button
          type="button"
          className="halo-brief-icon"
          onClick={() => go(safeIndex + 1)}
          disabled={safeIndex >= slides.length - 1}
        >
          Next
        </button>
        <button type="button" className="halo-brief-icon" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="halo-brief-icon" onClick={onClose}>
          Close
        </button>
        {/* Keyed so the timing bar restarts with each slide. */}
        <i
          className="halo-brief-progress"
          key={`${safeIndex}-${playing}`}
          style={
            playing && safeIndex < slides.length - 1
              ? { animation: `halo-brief-fill ${ADVANCE_MS}ms linear forwards` }
              : undefined
          }
        />
      </div>

      <div className="halo-brief-stage" ref={stageRef}>
        <div className="halo-brief-slide" key={current?.id}>
          {current?.body}
        </div>
      </div>

      <div className="halo-brief-foot">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="halo-brief-step"
            data-on={i === safeIndex}
            onClick={() => go(i)}
          >
            {s.step}
          </button>
        ))}
      </div>
    </div>
  );
}
