/**
 * Entrata CSV v1 — parse unit / lease / notice / PO exports.
 * Dates stay civil (Y-M-D parts). Money is bigint cents. Never "the API".
 */

import { dollarsToCents, type Cents } from "./moneyCents";
import type { EntrataImportKind } from "./schema/client_portfolio";

export type CsvRow = Record<string, string>;

export type ParsedUnitRow = {
  row: number;
  propertyCode: string;
  unitNumber: string;
  entrataUnitId: string | null;
  bedrooms: number;
  bathrooms: string;
  sqft: number | null;
  marketRentCents: Cents;
};

export type ParsedLeaseRow = {
  row: number;
  propertyCode: string;
  unitNumber: string;
  leaseId: string;
  moveIn: CivilParts | null;
  moveOut: CivilParts | null;
  rentCents: Cents | null;
  status: string | null;
};

export type ParsedNoticeRow = {
  row: number;
  propertyCode: string;
  unitNumber: string;
  noticeId: string;
  noticeDate: CivilParts;
  scheduledVacate: CivilParts | null;
  leaseId: string | null;
};

export type ParsedPoRow = {
  row: number;
  propertyCode: string;
  unitNumber: string | null;
  poNumber: string;
  amountCents: Cents;
  glCode: string | null;
  issuedOn: string | null;
};

export type CivilParts = { year: number; month: number; day: number };

const UNIT_HEADERS: Record<string, string> = {
  propertyid: "propertyCode",
  property_id: "propertyCode",
  "property id": "propertyCode",
  entratapropertyid: "propertyCode",
  "entrata property id": "propertyCode",
  propertycode: "propertyCode",
  "property code": "propertyCode",
  unitnumber: "unitNumber",
  unit_number: "unitNumber",
  "unit number": "unitNumber",
  unit: "unitNumber",
  unitid: "entrataUnitId",
  unit_id: "entrataUnitId",
  "unit id": "entrataUnitId",
  "entrata unit id": "entrataUnitId",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  br: "bedrooms",
  bathrooms: "bathrooms",
  baths: "bathrooms",
  sqft: "sqft",
  "sq ft": "sqft",
  "square feet": "sqft",
  marketrent: "marketRent",
  "market rent": "marketRent",
  rent: "marketRent",
};

const LEASE_HEADERS: Record<string, string> = {
  ...pick(UNIT_HEADERS, ["propertyCode", "unitNumber"]),
  leaseid: "leaseId",
  lease_id: "leaseId",
  "lease id": "leaseId",
  movein: "moveIn",
  "move in": "moveIn",
  "move in date": "moveIn",
  moveout: "moveOut",
  "move out": "moveOut",
  "move out date": "moveOut",
  "lease end": "moveOut",
  rent: "rent",
  currentrent: "rent",
  "current rent": "rent",
  status: "status",
};

const NOTICE_HEADERS: Record<string, string> = {
  ...pick(UNIT_HEADERS, ["propertyCode", "unitNumber"]),
  noticeid: "noticeId",
  notice_id: "noticeId",
  "notice id": "noticeId",
  ntv: "noticeId",
  noticedate: "noticeDate",
  "notice date": "noticeDate",
  "ntv date": "noticeDate",
  scheduledvacate: "scheduledVacate",
  "scheduled vacate": "scheduledVacate",
  "vacate date": "scheduledVacate",
  "move out date": "scheduledVacate",
  leaseid: "leaseId",
  lease_id: "leaseId",
  "lease id": "leaseId",
};

const PO_HEADERS: Record<string, string> = {
  ...pick(UNIT_HEADERS, ["propertyCode", "unitNumber"]),
  ponumber: "poNumber",
  po_number: "poNumber",
  "po number": "poNumber",
  po: "poNumber",
  amount: "amount",
  total: "amount",
  gl: "glCode",
  glcode: "glCode",
  "gl code": "glCode",
  date: "issuedOn",
  issuedon: "issuedOn",
  "issued on": "issuedOn",
};

function pick(map: Record<string, string>, keep: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (keep.includes(v)) out[k] = v;
  }
  return out;
}

export function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** RFC 4180-ish. Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function csvRecords(text: string, aliases: Record<string, string>): CsvRow[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const headers = grid[0]!.map((h) => aliases[normalizeHeader(h)] ?? normalizeHeader(h));
  return grid.slice(1).map((cells) => {
    const rec: CsvRow = {};
    headers.forEach((key, idx) => {
      rec[key] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
}

export function parseCivilDate(raw: string): CivilParts | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    return { year: Number(us[3]), month: Number(us[1]), day: Number(us[2]) };
  }
  throw new Error(`unrecognized date: ${raw}`);
}

function required(rec: CsvRow, key: string, row: number): string {
  const v = (rec[key] ?? "").trim();
  if (!v) throw new Error(`row ${row}: ${key} is required`);
  return v;
}

export function parseUnitRows(csv: string): ParsedUnitRow[] {
  return csvRecords(csv, UNIT_HEADERS).map((rec, i) => {
    const row = i + 2;
    const rentRaw = rec.marketRent || "0";
    return {
      row,
      propertyCode: required(rec, "propertyCode", row),
      unitNumber: required(rec, "unitNumber", row),
      entrataUnitId: rec.entrataUnitId || null,
      bedrooms: Math.max(1, Number.parseInt(rec.bedrooms || "1", 10) || 1),
      bathrooms: rec.bathrooms || "1.0",
      sqft: rec.sqft ? Number.parseInt(rec.sqft, 10) || null : null,
      marketRentCents: rentRaw.includes(".") || rentRaw.includes("$") || rentRaw.includes(",")
        ? dollarsToCents(rentRaw)
        : dollarsToCents(/^\d+$/.test(rentRaw) ? `${rentRaw}.00` : rentRaw),
    };
  });
}

export function parseLeaseRows(csv: string): ParsedLeaseRow[] {
  return csvRecords(csv, LEASE_HEADERS).map((rec, i) => {
    const row = i + 2;
    return {
      row,
      propertyCode: required(rec, "propertyCode", row),
      unitNumber: required(rec, "unitNumber", row),
      leaseId: required(rec, "leaseId", row),
      moveIn: rec.moveIn ? parseCivilDate(rec.moveIn) : null,
      moveOut: rec.moveOut ? parseCivilDate(rec.moveOut) : null,
      rentCents: rec.rent ? dollarsToCents(rec.rent.includes(".") || rec.rent.includes("$") ? rec.rent : `${rec.rent}.00`) : null,
      status: rec.status || null,
    };
  });
}

export function parseNoticeRows(csv: string): ParsedNoticeRow[] {
  return csvRecords(csv, NOTICE_HEADERS).map((rec, i) => {
    const row = i + 2;
    const noticeDate = parseCivilDate(required(rec, "noticeDate", row));
    if (!noticeDate) throw new Error(`row ${row}: noticeDate is required`);
    return {
      row,
      propertyCode: required(rec, "propertyCode", row),
      unitNumber: required(rec, "unitNumber", row),
      noticeId: required(rec, "noticeId", row),
      noticeDate,
      scheduledVacate: rec.scheduledVacate ? parseCivilDate(rec.scheduledVacate) : null,
      leaseId: rec.leaseId || null,
    };
  });
}

export function parsePoRows(csv: string): ParsedPoRow[] {
  return csvRecords(csv, PO_HEADERS).map((rec, i) => {
    const row = i + 2;
    const amountRaw = required(rec, "amount", row);
    return {
      row,
      propertyCode: required(rec, "propertyCode", row),
      unitNumber: rec.unitNumber || null,
      poNumber: required(rec, "poNumber", row),
      amountCents:
        amountRaw.includes(".") || amountRaw.includes("$") || amountRaw.includes(",")
          ? dollarsToCents(amountRaw)
          : dollarsToCents(`${amountRaw}.00`),
      glCode: rec.glCode || null,
      issuedOn: rec.issuedOn || null,
    };
  });
}

export function firstPropertyCode(csv: string): string | null {
  const recs = csvRecords(csv, UNIT_HEADERS);
  const code = recs[0]?.propertyCode?.trim();
  return code || null;
}

export function csvTemplate(kind: EntrataImportKind): string {
  switch (kind) {
    case "units":
      return "Property ID,Unit Number,Unit ID,Bedrooms,Bathrooms,Sq Ft,Market Rent\nPALOMA,140,U-140,2,2.0,980,$1450.00\n";
    case "leases":
      return "Property ID,Unit Number,Lease ID,Move In,Move Out,Rent,Status\nPALOMA,140,L-9001,2025-09-01,2026-08-31,$1450.00,Notice\n";
    case "notices":
      return "Property ID,Unit Number,Notice ID,Notice Date,Scheduled Vacate,Lease ID\nPALOMA,140,NTV-140,2026-08-01,2026-08-31,L-9001\n";
    case "purchase_orders":
      return "Property ID,Unit Number,PO Number,Amount,GL Code,Issued On\nPALOMA,140,PO-140-260801,$890.00,6200,2026-08-01\n";
  }
}

/** Prefix a leading formula character so spreadsheet apps do not execute it. */
export function guardCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
