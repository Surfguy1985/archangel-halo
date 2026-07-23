import type { FoundingWingsConfig } from "../config";
import type { ScoreInput, ScoreResult, WingTier } from "./types";
import { average, bayesianAverage, clamp, ratio, round } from "./math";

export function tierForScore(score: number, config: FoundingWingsConfig): WingTier {
  const thresholds = config.score.thresholds;
  if (score >= thresholds.platinum) return "PLATINUM";
  if (score >= thresholds.gold) return "GOLD";
  if (score >= thresholds.silver) return "SILVER";
  if (score >= thresholds.training) return "TRAINING";
  return "GROUNDED";
}

export function calculateHaloScore(input: ScoreInput, config: FoundingWingsConfig): ScoreResult {
  const prior = config.score.priorScore;
  const priorWeight = config.score.priorWeight;
  const sampleSize = input.completedJobCount;

  const rawInspection = average(input.inspectionScores, prior);
  const inspection = bayesianAverage(rawInspection, input.inspectionScores.length, prior, priorWeight);

  const rawCustomer = average(input.customerRatings.map((rating) => rating * 20), prior);
  const customer = bayesianAverage(rawCustomer, input.customerRatings.length, prior, priorWeight);

  const callbackFree = clamp(100 - ratio(input.callbackCount, Math.max(1, sampleSize), 0) * 100, 0, 100);
  const damageFree = clamp(100 - ratio(input.damageCount, Math.max(1, sampleSize), 0) * 150, 0, 100);

  const qualityPercent =
    inspection * 0.45 + customer * 0.25 + callbackFree * 0.2 + damageFree * 0.1;

  const onTime = ratio(input.onTimeCount, input.onTimeMeasuredCount, prior / 100) * 100;
  const attendance = ratio(input.attendedCount, input.attendanceMeasuredCount, prior / 100) * 100;
  const completion = ratio(input.completedJobCount, input.acceptedAssignmentCount, prior / 100) * 100;
  const communication = bayesianAverage(
    average(input.communicationRatings.map((rating) => rating * 20), prior),
    input.communicationRatings.length,
    prior,
    priorWeight
  );
  const reliabilityPercent = onTime * 0.35 + attendance * 0.35 + completion * 0.2 + communication * 0.1;

  const professionalism = bayesianAverage(
    average(input.professionalismRatings.map((rating) => rating * 20), prior),
    input.professionalismRatings.length,
    prior,
    priorWeight
  );
  const professionalismPercent = professionalism * 0.6 + communication * 0.4;

  const safetyCompliance = bayesianAverage(
    average(input.safetyScores, prior),
    input.safetyScores.length,
    prior,
    priorWeight
  );
  const incidentFree = clamp(100 - input.safetyIncidentCount * 25, 0, 100);
  const safetyPercent = safetyCompliance * 0.7 + incidentFree * 0.3;

  const mentorshipObserved = clamp(input.activeQualityRecruitCount / 5, 0, 1) * 100;
  const rescueObserved = clamp(input.completedRescueMissionCount / 4, 0, 1) * 100;
  const mentorshipPercent = bayesianAverage(
    mentorshipObserved,
    input.activeQualityRecruitCount,
    prior,
    priorWeight
  );
  const rescuePercent = bayesianAverage(
    rescueObserved,
    input.completedRescueMissionCount,
    prior,
    priorWeight
  );
  const teamPercent = mentorshipPercent * 0.6 + rescuePercent * 0.4;

  const points = {
    quality: round((qualityPercent / 100) * 35),
    reliability: round((reliabilityPercent / 100) * 25),
    professionalism: round((professionalismPercent / 100) * 15),
    safety: round((safetyPercent / 100) * 15),
    team: round((teamPercent / 100) * 10)
  };

  const totalScore = round(
    clamp(points.quality + points.reliability + points.professionalism + points.safety + points.team, 0, 100)
  );
  const confidence = round(clamp(sampleSize / (sampleSize + priorWeight * 2), 0, 1), 3);
  const reasons: string[] = [];

  if (callbackFree < 80) reasons.push("Callbacks are reducing the quality component.");
  if (onTime < 85) reasons.push("On-time performance is below the premium-job standard.");
  if (safetyPercent < 85) reasons.push("Safety performance requires attention.");
  if (input.activeQualityRecruitCount > 0) reasons.push("Quality recruits are adding team-contribution points.");
  if (input.completedRescueMissionCount > 0) reasons.push("Save the Mission work is adding leadership points.");
  if (sampleSize < 3) reasons.push("Score confidence is limited until at least three jobs are completed.");

  const tier = sampleSize < 3
    ? totalScore < config.score.thresholds.training ? "GROUNDED" : "TRAINING"
    : tierForScore(totalScore, config);

  return {
    totalScore,
    tier,
    confidence,
    points,
    sampleSize,
    reasons
  };
}
