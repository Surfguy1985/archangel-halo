import { Router, type IRouter } from "express";
import healthRouter from "./health";
import todayRouter from "./today";
import propertiesRouter from "./properties";
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
import portalRouter from "./portal";
import packetsRouter from "./packets";
import calendarRouter from "./calendar";
import settingsRouter from "./settings";
import plaidRouter from "./plaid";
import geoRouter from "./geo";
import arrivalsRouter from "./arrivals";
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
import voiceEodRouter from "./voiceEod";
import exchangeRouter from "./exchange";

const router: IRouter = Router();

// --- Client board hardening: session exchange, cookie-or-token auth, rate limits ---
import { clientSessionExchangeHandler, clientAuth, resolveClientPropertyIdForToken } from "../lib/sessionAuth";
import { limits } from "../lib/rateLimit";

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

// --- Office lockdown: passcode + session cookie for everything that isn't a
// token-authenticated client/crew/public-share surface or an inbound webhook.
import officeAuthRouter, { officeGuard } from "../lib/officeAuth";
import { enforcerGuard } from "../lib/enforcer";
import { falkonMutationGuard } from "../lib/falkonMutationGuard";
router.use(officeAuthRouter);
router.use(officeGuard());
router.use(enforcerGuard());
router.use(falkonMutationGuard());

router.use(healthRouter);
router.use(todayRouter);
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
router.use(portalRouter);
router.use(packetsRouter);
router.use(calendarRouter);
router.use(settingsRouter);
router.use(plaidRouter);
router.use(geoRouter);
router.use(arrivalsRouter);
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
router.use(falkonRouter);
router.use(falkonWebhookRouter);
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
router.use(voiceEodRouter);
router.use(exchangeRouter);

export default router;
