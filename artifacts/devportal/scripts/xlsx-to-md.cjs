const XLSX = require("xlsx");
const fs = require("fs");

const [, , input, output, title] = process.argv;
const wb = XLSX.readFile(input);
const esc = (v) => (v == null ? "" : String(v).replace(/\|/g, "\\|").trim());
const fmt = (v) => {
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return esc(v);
};

let md = `# ${title}\n\n`;
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
  md += "## " + name + "\n\n";
  let i = 0;
  while (i < rows.length) {
    const r = (rows[i] || []).filter((c) => c != null && String(c).trim() !== "");
    if (r.length === 0) {
      i++;
      continue;
    }
    if (r.length <= 2) {
      const text = r.map(fmt).join(" — ");
      if (text !== title) {
        if (/^[A-Z0-9 \/&\-,']+$/.test(text) && text.length < 70) {
          md += "### " + text.charAt(0) + text.slice(1).toLowerCase() + "\n\n";
        } else {
          md += text + "\n\n";
        }
      }
      i++;
      continue;
    }
    const header = rows[i] || [];
    const width = header.length;
    const body = [];
    let j = i + 1;
    while (j < rows.length && (rows[j] || []).some((c) => c != null && String(c).trim() !== "")) {
      body.push(rows[j] || []);
      j++;
    }
    const cols = [...Array(width).keys()].filter(
      (k) => header[k] != null || body.some((b) => b[k] != null)
    );
    md += "| " + cols.map((k) => fmt(header[k])).join(" | ") + " |\n";
    md += "|" + cols.map(() => "---").join("|") + "|\n";
    for (const b of body) md += "| " + cols.map((k) => fmt(b[k])).join(" | ") + " |\n";
    md += "\n";
    i = j;
  }
}
fs.writeFileSync(output, md);
console.log("Wrote", output, md.split("\n").length, "lines");
