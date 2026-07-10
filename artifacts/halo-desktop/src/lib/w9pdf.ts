import { jsPDF } from "jspdf";

type W9 = Record<string, unknown>;

function val(data: W9, key: string): string {
  const v = data[key];
  return v == null ? "" : String(v);
}

export function downloadW9Pdf(data: W9, crewName?: string): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 56;
  let y = 64;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Form W-9", left, y);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  y += 18;
  doc.text("Request for Taxpayer Identification Number and Certification", left, y);
  y += 26;
  doc.setDrawColor(180);
  doc.line(left, y, 556, y);
  y += 24;

  const tinType = val(data, "tinType");
  const rows: [string, string][] = [
    ["Name", val(data, "name")],
    ["Business name", val(data, "businessName")],
    ["Tax classification", val(data, "taxClassification")],
    ["Address", val(data, "address")],
    ["City", val(data, "city")],
    ["State", val(data, "state")],
    ["ZIP", val(data, "zip")],
    [tinType === "ein" ? "EIN" : "SSN", tinType === "ein" ? val(data, "ein") : val(data, "ssn")],
    ["Signature", val(data, "signature")],
    ["Signed date", val(data, "signedDate")],
  ];

  doc.setFontSize(11);
  for (const [label, value] of rows) {
    if (!value) continue;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, left, y);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(value, 360), left + 130, y);
    y += 24;
  }

  const safeName = (crewName || val(data, "name") || "crew")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  doc.save(`w9-${safeName || "crew"}.pdf`);
}
