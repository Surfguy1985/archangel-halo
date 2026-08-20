import { Router, type IRouter } from "express";
import healthRouter from "./health";
import todayRouter from "./today";
import propertiesRouter from "./properties";
import siteTwinRouter from "./siteTwin";
import pipelineRouter from "./pipeline";
import jobsRouter from "./jobs";
import jobBoardRouter from "./jobboard";
import moneyRouter from "./money";
import inventoryRouter from "./inventory";
import activityRouter from "./activity";
import voiceRouter from "./voice";
import ingestRouter from "./ingest";
import notifyRouter from "./notify";
import storageRouter from "./storage";
import crewRouter from "./crew";
import crewJoinRouter from "./crewJoin";
import rosterRouter from "./roster";
import portalRouter from "./portal";
import packetsRouter from "./packets";
import calendarRouter from "./calendar";
import settingsRouter from "./settings";
import plaidRouter from "./plaid";
import geoRouter from "./geo";
import arrivalsRouter from "./arrivals";
import fieldRouter from "./field";
import accountingRouter from "./accounting";
import taxPlannerRouter from "./taxPlanner";
import vapiRouter from "./vapi";
import wingsRouter from "./wings";
import payhubRouter from "./payhub";
import sopRouter from "./sop";
import adminRouter from "./admin";
import jobSummariesRouter from "./jobSummaries";
import clientAccessRouter from "./clientAccess";
import workRequestsRouter from "./workRequests";
import invoiceJobDraftRouter from "./invoiceJobDraft";
import clientBoardRouter from "./clientBoard";
import clientCmsRouter from "./clientCms";
import conciergeRouter from "./concierge";
import presentationRouter from "./presentation";
import emergencyRouter from "./emergency";
import dispatchBoardRouter from "./dispatchBoard";
import walksRouter from "./walks";
import falkonRouter from "./falkon";
import { falkonWebhookRouter } from "./falkonWebhook";
import discrepanciesRouter from "./discrepancies";
import pulseUnitsRouter from "./pulseUnits";
import agentsRouter from "./agents";
import workLoggedRouter from "./workLogged";
import workReviewsRouter from "./workReviews";
import haloOperatorRouter from "./haloOperator";
import invoiceDraftsRouter from "./invoiceDrafts";
import pulseHomeRouter from "./pulseHome";
import portfolioHomeRouter from "./portfolioHome";
import opsRouter from "./ops";
import { falkonAdminRouter } from "./falkonAdmin";
import { falkonNetworkRouter } from "./falkonNetwork";
import commandRouter from "./command";
import pmLinksRouter from "./pmLinks";
import crewCheckinLinksRouter from "./crewCheckinLinks";
import weatherRouter from "./weather";
import briefingsRouter from "./briefings";
import catalogLookupRouter from "./catalogLookup";
import estimatesRouter from "./estimates";
import smsOfficeRouter, { twilioWebhookRouter } from "./sms";
import crewMergeRouter from "./crewMerge";
import voiceEodRouter from "./voiceEod";
import exchangeRouter from "./exchange";
import intelligenceRouter from "./intelligence";
import falkonTestHelperRouter from "./falkonTestHelper";
import remindersRouter from "./reminders";
import { boardWorkspaceRouter } from "./boardWorkspace";
import portfolioPulseRouter from "./portfolioPulse";
import propertyTurnBoardRouter from "./propertyTurnBoard";
import propertyEvidenceRouter from "./propertyEvidence";
import propertyInvoiceRouter from "./propertyInvoice";
import entrataImportRouter from "./entrataImport";
import costToServeRouter from "./costToServe";
import bidBoardRouter from "./bidBoard";
import turnPipelineRouter from "./turnPipeline";
import clientBoardAuditRouter from "./clientBoardAudit";

const router: IRouter = Router();

// --- Client board hardening: session exchange, cookie-or-token auth, rate limits ---
import { clientSessionExchangeHandler, clientAuth, resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { limits, limitClientBoard } from "../lib/rateLimit";
import { demoSafeJson } from "../lib/demoSafe";

// Concierge must be mounted BEFORE clientAuth so its own resolveViewer()
// handles both guest and signed-in users. clientAuth's STRICT_MODE would
// 401 the POST before it reached the handler for unauthenticated clients.
router.use(conciergeRouter);
router.use(twilioWebhookRouter);

router.post("/client/:token/session", limits.session, clientSessionExchangeHandler());
router.use("/client/:token", clientAuth(resolveClientPropertyIdForToken));
// Rate-limit only mutating pay requests — GET page loads stay unthrottled so
// shared-IP viewers and refreshes never 429 the public payment page.
router.use("/pay/:token", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  limits.pay(req, res, next);
});

// --- No office lockdown. The owner asked for every password and login in HALO
// to be removed, so /api is open: there is no passcode, no session cookie and
// no sign-in route. Token surfaces (client boards, crew links, signed webhooks)
// still prove themselves per request — see lib/publicPaths.ts.
import { enforcerGuard } from "../lib/enforcer";
import { falkonMutationGuard } from "../lib/falkonMutationGuard";
router.use(enforcerGuard());
router.use(falkonMutationGuard());

router.use(healthRouter);
router.use(todayRouter);
router.use(siteTwinRouter);
router.use(propertiesRouter);
router.use(pipelineRouter);
router.use(jobsRouter);
router.use(jobBoardRouter);
router.use(emergencyRouter);
router.use(dispatchBoardRouter);
router.use(moneyRouter);
router.use(inventoryRouter);
router.use(activityRouter);
router.use(voiceRouter);
router.use(ingestRouter);
router.use(notifyRouter);
router.use(storageRouter);
router.use(crewRouter);
router.use(crewJoinRouter);
router.use(rosterRouter);
router.use(portalRouter);
router.use(packetsRouter);
router.use(calendarRouter);
router.use(settingsRouter);
router.use(plaidRouter);
router.use(geoRouter);
router.use(arrivalsRouter);
router.use(fieldRouter);
router.use(accountingRouter);
router.use(taxPlannerRouter);
router.use(vapiRouter);
router.use(wingsRouter);
router.use(payhubRouter);
router.use(sopRouter);
router.use(adminRouter);
router.use(jobSummariesRouter);
router.use(clientAccessRouter);
router.use(clientBoardRouter);
router.use(clientCmsRouter);
router.use(workRequestsRouter);
router.use(invoiceJobDraftRouter);
router.use(presentationRouter);
router.use(walksRouter);
// Mount the test helper ONLY when HALO_E2E_ENABLED=1 — never in production.
// There is no passcode gate any more, so the production hard-fail below is the
// A startup hard-fail prevents the flag from accidentally reaching production.
if (process.env.HALO_E2E_ENABLED === "1") {
  if (process.env.NODE_ENV === "production") {
    // Refuse to boot — this is a deliberate fail-closed rather than a silent
    // skip so that a misconfigured deployment is immediately visible in logs.
    throw new Error(
      "FATAL: HALO_E2E_ENABLED=1 must never be set in a production environment. " +
        "Remove the flag before deploying.",
    );
  }
  router.use(falkonTestHelperRouter);
}
router.use(falkonRouter);
router.use(falkonWebhookRouter);
router.use(discrepanciesRouter);
router.use(pulseUnitsRouter);
router.use(agentsRouter);
router.use(workLoggedRouter);
router.use(workReviewsRouter);
router.use(haloOperatorRouter);
router.use(invoiceDraftsRouter);
router.use(pulseHomeRouter);
router.use(portfolioHomeRouter);
router.use(opsRouter);
router.use(falkonAdminRouter);
router.use(falkonNetworkRouter);
router.use(commandRouter);
router.use(pmLinksRouter);
router.use(crewCheckinLinksRouter);
router.use(weatherRouter);
router.use(briefingsRouter);
router.use(catalogLookupRouter);
router.use(estimatesRouter);
router.use(smsOfficeRouter);
router.use(crewMergeRouter);
router.use(voiceEodRouter);
router.use(exchangeRouter);
router.use(intelligenceRouter);
router.use(remindersRouter);
router.use(boardWorkspaceRouter);
router.use(demoSafeJson, limitClientBoard, portfolioPulseRouter);
router.use(demoSafeJson, limitClientBoard, propertyTurnBoardRouter);
router.use(demoSafeJson, limitClientBoard, propertyEvidenceRouter);
router.use(demoSafeJson, limitClientBoard, propertyInvoiceRouter);
router.use(demoSafeJson, limitClientBoard, entrataImportRouter);
router.use(demoSafeJson, limitClientBoard, costToServeRouter);
router.use(demoSafeJson, limitClientBoard, bidBoardRouter);
router.use(demoSafeJson, limitClientBoard, turnPipelineRouter);
router.use(demoSafeJson, limitClientBoard, clientBoardAuditRouter);

export default router;
