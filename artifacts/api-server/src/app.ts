import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
              /(\/(client|portal|pay|track|recap-shares|photo-shares|job-summaries|board|summary)\/)[^/]+/,
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
app.use(cors());
app.use(cookieParser());
app.use(
  [
    "/api/ingest/scan",
    "/api/ingest/receipt",
    "/api/checks/scan",
    "/api/properties/:id/sop-rule",
  ],
  express.json({ limit: "15mb" }),
);
app.use(express.json({ limit: "2mb" }));
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

export default app;
