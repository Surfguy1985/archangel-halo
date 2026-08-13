import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureChartOfAccounts } from "./lib/ledger";
import { ensureFalkonSchema } from "./lib/ensureFalkonSchema";
import { ensureFalkonIdentity } from "./lib/falkonIdentity";
import { ensureBase44Schema } from "./lib/ensureBase44Schema";
import { ensureEnforcerSchema } from "./lib/ensureEnforcerSchema";
import { startFalkonNetworkPoller } from "./lib/falkonNetworkPoller";
import { seedExchangeProducts } from "./lib/seedExchangeProducts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
  ensureChartOfAccounts().catch((err) =>
    logger.error({ err }, "Failed to seed chart of accounts"),
  );
  // Falkon: schema first, then identity, then network poller, then Exchange seeding.
  // Order matters: tables must exist before identity + seeder run.
  ensureFalkonSchema()
    .then(() => ensureFalkonIdentity())
    .then(() => startFalkonNetworkPoller())
    .then(() =>
      // Phase 3: seed canonical Exchange workflow products (idempotent, non-fatal).
      seedExchangeProducts().catch((err) =>
        logger.warn({ err }, "Exchange product seeding failed (non-fatal)"),
      ),
    )
    .catch((err) =>
      logger.error({ err }, "Failed to bootstrap Falkon schema or identity"),
    );
  ensureBase44Schema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap Base44 projection schema"),
  );
  ensureEnforcerSchema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap Enforcer/PM-link schema"),
  );
});
