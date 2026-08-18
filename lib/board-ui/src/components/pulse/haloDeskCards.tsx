import type { CatalogItem, Job, PortfolioPulseDocument } from "@workspace/api-client-react";
import { formatUsdCents } from "./formatUsdCents";
import {
  downloadVacancyCsv,
  priceBookRows,
  priceLabel,
  vendorDeskRows,
  type VendorDeskRow,
} from "./haloDeskIntel";
import "./haloLevels.css";

export function HaloReportsCard(props: {
  pulse: PortfolioPulseDocument | undefined;
  onPresent?: () => void;
  presenting?: boolean;
}) {
  const tiles = [...(props.pulse?.tiles ?? [])].sort((a, b) => {
    try {
      const d = BigInt(b.vacancyCostCents) - BigInt(a.vacancyCostCents);
      if (d === 0n) return a.name.localeCompare(b.name);
      return d > 0n ? 1 : -1;
    } catch {
      return a.name.localeCompare(b.name);
    }
  });
  return (
    <div className="halo-desk">
      <p className="halo-desk-lead">Vacancy cost is empty-home rent over the target turn — one clock, every community.</p>
      <div className="halo-desk-actions">
        <button
          type="button"
          className="halo-desk-cta"
          disabled={!props.pulse}
          onClick={() => props.pulse && downloadVacancyCsv(props.pulse)}
        >
          Export CSV
        </button>
        {props.onPresent ? (
          <button type="button" className="halo-desk-ghost" disabled={props.presenting} onClick={props.onPresent}>
            {props.presenting ? "Seeding…" : "Present"}
          </button>
        ) : null}
      </div>
      {tiles.length === 0 ? <p className="halo-desk-empty">No communities in this window yet.</p> : null}
      {tiles.map((t) => (
        <div key={t.propertyId} className="halo-desk-row">
          <strong>{t.name}</strong>
          <em>{formatUsdCents(t.vacancyCostCents)}</em>
          <span>
            {t.unitsInTurn} in turn
            {t.medianTurnDays != null ? ` · ${t.medianTurnDays.toFixed(1)}d` : ""}
            {t.city ? ` · ${t.city}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HaloVendorsCard(props: {
  jobs: Job[];
  catalog: CatalogItem[];
  onOpenCatalog?: () => void;
  onOpenWork?: () => void;
}) {
  const rows: VendorDeskRow[] = vendorDeskRows(props.jobs);
  const book = priceBookRows(props.catalog);
  return (
    <div className="halo-desk">
      <div className="halo-desk-actions">
        <button type="button" className="halo-desk-cta" onClick={props.onOpenCatalog}>
          Price book
        </button>
        {props.onOpenWork ? (
          <button type="button" className="halo-desk-ghost" onClick={props.onOpenWork}>
            Base44
          </button>
        ) : null}
      </div>
      <p className="halo-desk-kicker">Master pricing</p>
      {book.length === 0 ? <p className="halo-desk-empty">Sync Base44 to load the price book.</p> : null}
      {book.slice(0, 6).map((item) => (
        <div key={item.id} className="halo-desk-row slim">
          <strong>{item.service}</strong>
          <em>{priceLabel(item)}</em>
          <span>{item.category || item.detail || item.unit || "Catalog"}</span>
        </div>
      ))}
      <p className="halo-desk-kicker">Vendors</p>
      {rows.length === 0 ? <p className="halo-desk-empty">No vendor work in this window.</p> : null}
      {rows.map((row) => (
        <div key={row.name} className="halo-desk-row">
          <strong>{row.name}</strong>
          <em>{row.avgTurnDays == null ? "—" : `${row.avgTurnDays.toFixed(1)}d`}</em>
          <span>
            {row.jobs} jobs · avg {row.avgCostLabel}
            {row.callbacks > 0 ? ` · ${row.callbacks} callbacks` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function HaloWaitingCard(props: {
  poJobs: Job[];
  uncrewed: Job[];
  onOpenWork?: () => void;
}) {
  return (
    <div className="halo-desk">
      <p className="halo-desk-lead">HALO holds the office clock. The work app holds the punch.</p>
      {props.onOpenWork ? (
        <div className="halo-desk-actions">
          <button type="button" className="halo-desk-cta" onClick={props.onOpenWork}>
            Open Work app
          </button>
        </div>
      ) : null}
      <p className="halo-desk-kicker">Waiting on a PO</p>
      {props.poJobs.length === 0 ? <p className="halo-desk-empty">Every live job has a PO.</p> : null}
      {props.poJobs.slice(0, 8).map((j) => (
        <div key={j.id} className="halo-desk-row">
          <strong>{j.unitNo ? `Unit ${j.unitNo}` : j.jobNo}</strong>
          <em>PO</em>
          <span>{j.propertyName ?? "—"}</span>
        </div>
      ))}
      <p className="halo-desk-kicker">Need a crew</p>
      {props.uncrewed.length === 0 ? <p className="halo-desk-empty">Every live job has a crew.</p> : null}
      {props.uncrewed.slice(0, 8).map((j) => (
        <div key={j.id} className="halo-desk-row">
          <strong>{j.unitNo ? `Unit ${j.unitNo}` : j.jobNo}</strong>
          <em>Crew</em>
          <span>{j.propertyName ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
