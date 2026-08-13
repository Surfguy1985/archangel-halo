import express, { type Express, type Request } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildTrustDoc } from "./lib/falkonIdentity";
import { corsOriginSetting } from "./lib/corsPolicy";

// Extend Request so rawBody is available for webhook signature verification
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
      haloIdentity?: import("./lib/enforcerCore").HaloIdentity;
    }
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Capability tokens live in URL paths — redact them from logs.
          url: req.url
            ?.split("?")[0]
            ?.replace(
              /(\/(client|portal|pay|track|recap-shares|photo-shares|job-summaries|board|summary|live|checkin)\/)[^/]+/,
              "$1<redacted>",
            ),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: corsOriginSetting(process.env),
    credentials: true,
  }),
);
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
});
// Capture rawBody before JSON parsing (needed for Falkon webhook Ed25519 verification)
const rawBodyCapture = (
  req: Request,
  _res: express.Response,
  buf: Buffer,
): void => {
  req.rawBody = buf.toString("utf8");
};

app.use(
  [
    "/api/ingest/scan",
    "/api/ingest/receipt",
    "/api/checks/scan",
    "/api/properties/:id/sop-rule",
    "/api/crew-invoices/scan",
  ],
  express.json({ limit: "15mb", verify: rawBodyCapture }),
);
app.use(express.json({ limit: "2mb", verify: rawBodyCapture }));

// ── Falkon trust document (served at /.well-known/ — root, NOT /api) ────────
app.get("/.well-known/falkon-trust.json", (req, res) => {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const origin = domain ? `https://${domain}` : `${req.protocol}://${req.headers.host}`;
  const doc = buildTrustDoc(origin);
  if (!doc) {
    return res.status(503).json({ error: "Identity not yet initialised" });
  }
  res.set("Cache-Control", "public, max-age=3600");
  return res.json(doc);
});
app.use(express.urlencoded({ extended: true }));

// Preset stage artwork for board cards — static, safe to cache hard.
app.use(
  "/api/rails-art",
  express.static("public/rails", { maxAge: "7d", immutable: false }),
);

// Office-uploaded reference documents (cleaning checklist PDF, etc.)
app.use(
  "/api/docs",
  express.static("public", { maxAge: "1d" }),
);

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", router);

// Root health — answers Replit's proxy health probe at GET /
app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "halo-api" });
});

export default app;
