import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureChartOfAccounts } from "./lib/ledger";
import { ensureFalkonSchema } from "./lib/ensureFalkonSchema";
import { ensureFalkonIdentity } from "./lib/falkonIdentity";
import { ensureBase44Schema } from "./lib/ensureBase44Schema";
import { ensureEnforcerSchema } from "./lib/ensureEnforcerSchema";
import { ensureCommsSchema } from "./lib/ensureCommsSchema";
import { startFalkonNetworkPoller } from "./lib/falkonNetworkPoller";
import { seedExchangeProducts } from "./lib/seedExchangeProducts";
import { ensureClientBoardSchema } from "./lib/ensureClientBoardSchema";
import { ensureClientPoSchema } from "./lib/ensureClientPoSchema";
import { ensureRemindersSchema } from "./lib/ensureRemindersSchema";
import { ensureFieldPhotoSchema } from "./lib/ensureFieldPhotoSchema";
import { ensureCrewJoinSchema } from "./lib/ensureCrewJoinSchema";
import { ensureCrewCompanySchema } from "./lib/ensureCrewCompanySchema";
import { ensureVendorContractSchema } from "./lib/ensureVendorContractSchema";
import { ensureJobsSchema } from "./lib/ensureJobsSchema";

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

/**
 * The vendors bootstrap blocks startup instead of running alongside the
 * others: several code paths (the vendors module, queues, voice, the command
 * brain) `select *` from vendors, so serving before its columns exist means
 * 500s on a live database. Exiting on failure lets the workflow restart and
 * retry rather than serving a schema the code can't read.
 */
ensureVendorContractSchema().then(startServer, (err) => {
  logger.error({ err }, "vendor contract schema bootstrap failed");
  process.exit(1);
});

function startServer() {
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
  const falkonSchemaReady = ensureFalkonSchema();
  falkonSchemaReady
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
  ensureClientBoardSchema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap client-board schema"),
  );
  ensureClientPoSchema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap client-PO-intake schema"),
  );
  ensureRemindersSchema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap reminders schema"),
  );
  ensureFieldPhotoSchema().catch((err) =>
    logger.error({ err }, "Failed to bootstrap field photo schema"),
  );
  ensureCrewJoinSchema().catch((err) =>
    logger.error({ err }, "crew join schema bootstrap failed"),
  );
  ensureCrewCompanySchema().catch((err) =>
    logger.error({ err }, "crew company schema bootstrap failed"),
  );
  // Must follow the Falkon bootstrap: that is where halo_sms_messages is
  // created, and these are ALTERs against it. On a fresh database the reverse
  // order fails and never retries, leaving the app querying columns that don't
  // exist. Reuse the same promise rather than calling ensureFalkonSchema()
  // again — a second call would race the first one's DDL.
  falkonSchemaReady
    .then(() => ensureCommsSchema())
    .catch((err) =>
      logger.error({ err }, "Failed to bootstrap SMS delivery-tracking schema"),
    );
});
}
