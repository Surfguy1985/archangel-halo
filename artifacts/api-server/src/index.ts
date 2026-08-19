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
import { ensureCrewPinColorSchema } from "./lib/ensureCrewPinColorSchema";
import { ensureCrewRosterSchema } from "./lib/ensureCrewRosterSchema";
import { ensureVendorContractSchema } from "./lib/ensureVendorContractSchema";
import { ensureJobsSchema } from "./lib/ensureJobsSchema";
import { ensureBoardWorkspaceSchema } from "./lib/ensureBoardWorkspaceSchema";
import { ensureCrewAckSchema } from "./lib/ensureCrewAckSchema";
import { ensureVendorRatesSchema } from "./lib/ensureVendorRatesSchema";
import { ensureInventorySchema } from "./lib/ensureInventorySchema";

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
// vendor_rates must exist before traffic is served: rate routes query it directly
// and there is no per-request readiness guard. Chain it with the vendor schema
// bootstrap so both complete (or fail loudly) before app.listen() is called.
// crews.pin_color joins them: drizzle selects it on every `select * from crews`
// (crew list, map pins, portal auth), so serving before the column exists turns
// every crew read into a 500.
ensureVendorContractSchema()
  .then(() => ensureVendorRatesSchema())
  .then(() => ensureCrewPinColorSchema())
  .then(() => ensureCrewRosterSchema())
  // jobs.priority is NOT NULL and drizzle enumerates it in every `select * from
  // jobs`, so until the DDL lands the board, today's queues and the command
  // snapshot all 500. It was written to be awaited before listen but was never
  // actually chained here, which is why the column was still missing.
  .then(() => ensureJobsSchema())
  // jobs.custom_fields joins priority: drizzle selects it on every jobs read.
  .then(() => ensureBoardWorkspaceSchema())
  .then(startServer, (err) => {
    logger.error({ err }, "vendor schema bootstrap failed");
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
  ensureInventorySchema().catch((err) =>
    logger.error({ err }, "inventory schema bootstrap failed"),
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
  void import("./lib/seedThornburyPulse")
    .then(({ ensureThornburyPulse }) => ensureThornburyPulse())
    .then((seeded) =>
      logger.info(
        {
          property: seeded.propertyName,
          tokenTail: seeded.dashboardToken.slice(-6),
          photos: seeded.photos,
          jobs: seeded.jobs,
        },
        "Thornbury Pulse workspace ready",
      ),
    )
    .catch((err) => logger.error({ err }, "Failed to seed Thornbury Pulse"));
});
}
