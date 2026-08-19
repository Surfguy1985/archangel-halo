/**
 * Browser E2E for Pulse: login, RailsBoard tiles, live map, seeded photos.
 *
 * Requires a running API + client-dashboard (vite proxy via HALO_API_ORIGIN).
 * Skips nothing — exit 1 on failure.
 *
 *   DATABASE_URL=... HALO_PULSE_PM_PASSWORD=... HALO_API_ORIGIN=http://127.0.0.1:3001 \
 *   PULSE_UI_ORIGIN=http://127.0.0.1:5173 node scripts/pulse-ui-e2e.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const puppeteer = require("puppeteer-core");
const { Client } = require(path.join(root, "lib/db/node_modules/pg"));

const API = process.env.HALO_API_ORIGIN || "http://127.0.0.1:3001";
const UI = process.env.PULSE_UI_ORIGIN || "http://127.0.0.1:5173";
const EMAIL = "pm@thornbury.chaseoaks";
const PASSWORD = process.env.HALO_PULSE_PM_PASSWORD;
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!PASSWORD) {
  console.error("HALO_PULSE_PM_PASSWORD is required");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `select ca.dashboard_token as token
     from client_accounts ca
     join properties p on p.id = ca.property_id
    where p.name ilike '%thornbur%'
    limit 1`,
);
await client.end();
const token = rows[0]?.token;
if (!token) {
  console.error("no Thornbury dashboard token");
  process.exit(1);
}

const jpeg = await fetch(`${API}/api/storage/objects/thornbury-pulse/photo-before-1.jpg`);
if (!jpeg.ok) {
  console.error("photo HTTP", jpeg.status);
  process.exit(1);
}
const bytes = Buffer.from(await jpeg.arrayBuffer());
if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
  console.error("photo is not JPEG");
  process.exit(1);
}

const login = await fetch(`${API}/api/client/${token}/board/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  console.error("login HTTP", login.status, await login.text());
  process.exit(1);
}
const session = (await login.json()).sessionToken;
const board = await fetch(`${API}/api/client/${token}/board`, {
  headers: { Authorization: `Bearer ${session}` },
});
const boardJson = await board.json();
if (!Array.isArray(boardJson.cards) || boardJson.cards.length < 2) {
  console.error("board cards missing", boardJson.cards?.length);
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
});
const page = await browser.newPage();
page.setDefaultTimeout(30_000);
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${UI}/${token}`, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForSelector('[data-testid="pulse-login"]');
await page.type('[data-testid="input-pulse-email"]', EMAIL);
await page.type('[data-testid="input-pulse-password"]', PASSWORD);
await page.click('[data-testid="button-pulse-login"]');
await page.waitForSelector('[data-testid="kpi-strip"]');
await page.waitForSelector('[data-testid="kpi-on-site"]');
const tiles = await page.$$('[data-testid^="rail-tile-"]');
if (tiles.length < 2) {
  await browser.close();
  console.error("expected rail tiles, got", tiles.length);
  process.exit(1);
}
await page.click('[data-testid="button-map-view"]');
await page.waitForFunction(() => location.pathname.endsWith("/map"));
await page.waitForSelector(".leaflet-container", { timeout: 20_000 });
const markers = await page.$$(".leaflet-marker-icon");
if (markers.length < 1) {
  await browser.close();
  console.error("no map markers");
  process.exit(1);
}
await markers[markers.length - 1].click();
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll("img")].filter((i) =>
    (i.getAttribute("src") || "").includes("/api/storage/objects/thornbury-pulse/"),
  );
  return imgs.length > 0;
}, { timeout: 15_000 });
await browser.close();
console.log(
  JSON.stringify({
    ok: true,
    tokenTail: token.slice(-6),
    cards: boardJson.cards.length,
    photoBytes: bytes.length,
    railTiles: tiles.length,
  }),
);
