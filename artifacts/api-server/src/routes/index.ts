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

export default router;
