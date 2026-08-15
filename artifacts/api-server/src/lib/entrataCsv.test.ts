import { describe, expect, it } from "vitest";
import {
  csvTemplate,
  dollarsToCents,
  parseCsv,
  parseNoticeRows,
  parseUnitRows,
  guardCsvCell,
} from "@workspace/db";

describe("Entrata CSV parser", () => {
  it("parses quoted commas and dollar rents into bigint cents", () => {
    const csv = `Property ID,Unit Number,Bedrooms,Market Rent\nPALOMA,"140",2,"$1,450.00"\n`;
    const rows = parseUnitRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.propertyCode).toBe("PALOMA");
    expect(rows[0]!.unitNumber).toBe("140");
    expect(rows[0]!.marketRentCents).toBe(145000n);
  });

  it("reads MM/DD/YYYY notice dates as civil parts, never UTC strings", () => {
    const rows = parseNoticeRows(
      `Property ID,Unit Number,Notice ID,Notice Date,Scheduled Vacate\nPALOMA,140,NTV-1,08/01/2026,08/31/2026\n`,
    );
    expect(rows[0]!.noticeDate).toEqual({ year: 2026, month: 8, day: 1 });
    expect(rows[0]!.scheduledVacate).toEqual({ year: 2026, month: 8, day: 31 });
  });

  it("guards spreadsheet formula cells", () => {
    expect(guardCsvCell("=cmd")).toBe("'=cmd");
    expect(parseCsv("a,b\n1,2\n")[1]).toEqual(["1", "2"]);
  });

  it("ships a template for each export kind", () => {
    expect(csvTemplate("units")).toMatch(/Property ID/);
    expect(csvTemplate("notices")).toMatch(/Notice ID/);
    expect(dollarsToCents("$890.00")).toBe(89000n);
  });
});
