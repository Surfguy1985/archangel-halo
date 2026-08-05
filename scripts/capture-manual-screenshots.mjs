import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const OUT = "artifacts/devportal/public/manual";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:80/desktop";

const PAGES = [
  ["today", "/"],
  ["properties", "/properties"],
  ["property-detail", null],
  ["jobboard", "/jobboard"],
  ["crews", "/crews"],
  ["invoice-new", "/invoices/new"],
  ["money", "/money"],
];

const browser = await puppeteer.launch({
  executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60000 });
await page.evaluate(async () => {
  await fetch("/api/office-auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: "12345678" }),
    credentials: "include",
  });
});

const propId = await page.evaluate(async () => {
  const r = await fetch("/api/properties", { credentials: "include" });
  const d = await r.json();
  const list = Array.isArray(d) ? d : d.properties ?? [];
  return list[0]?.id ?? null;
});

for (const [name, path] of PAGES) {
  const target = path ?? (propId ? `/properties/${propId}` : null);
  if (!target) continue;
  await page.goto(`${BASE}${target}`, { waitUntil: "networkidle2", timeout: 60000 });
  // dismiss splash (click-through) and give data a moment
  await page.mouse.click(720, 450); // dismiss splash overlay
  await new Promise((r) => setTimeout(r, 900));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}
await browser.close();
