import { Router, type IRouter } from "express";
import healthRouter from "./health";
import todayRouter from "./today";
import propertiesRouter from "./properties";
import pipelineRouter from "./pipeline";
import jobsRouter from "./jobs";
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

const router: IRouter = Router();

router.use(healthRouter);
router.use(todayRouter);
router.use(propertiesRouter);
router.use(pipelineRouter);
router.use(jobsRouter);
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

export default router;
