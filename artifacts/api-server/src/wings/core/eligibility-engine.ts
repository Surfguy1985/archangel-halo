import type { EligibilityJobInput, EligibilityMemberInput, EligibilityResult, EligibilityWindow } from "./types";
import { round } from "./math";

function hasValidCertification(
  code: string,
  certifications: EligibilityMemberInput["certifications"],
  now: Date
): boolean {
  const record = certifications.find((certification) => certification.code.toLowerCase() === code.toLowerCase());
  if (!record || record.verified === false) return false;
  if (!record.expiresAt) return true;
  return new Date(record.expiresAt) > now;
}

function determineWindow(member: EligibilityMemberInput): EligibilityWindow {
  const isFounder = member.founderStatus === "FOUNDING_WING" || member.founderStatus === "LEGACY";
  if (isFounder && member.tier === "PLATINUM") return "PLATINUM_FIRST";
  if (isFounder && member.tier === "GOLD") return "GOLD_SECOND";
  if (isFounder) return "FOUNDERS_THIRD";
  return "OPEN_FLIGHT";
}

export function evaluateEligibility(
  member: EligibilityMemberInput,
  job: EligibilityJobInput,
  now = new Date()
): EligibilityResult {
  const missingRequirements: string[] = [];
  const reasons: string[] = [];

  if (member.status !== "ACTIVE") missingRequirements.push("Member is not active.");
  if (!member.isAvailable) missingRequirements.push("Member is not currently available.");
  if (member.tier === "GROUNDED") missingRequirements.push("Member is grounded pending recertification.");
  if (member.haloScore < job.requiredHaloScore) {
    missingRequirements.push(`Halo Score ${member.haloScore.toFixed(1)} is below required ${job.requiredHaloScore.toFixed(1)}.`);
  }
  if (member.activeJobCount >= member.maxConcurrentJobs) missingRequirements.push("Member is at job capacity.");
  if (member.unresolvedCriticalIncidentCount > 0) missingRequirements.push("Member has an unresolved critical incident.");

  const normalizedSkills = new Set(member.tradeSkills.map((skill) => skill.toLowerCase()));
  for (const skill of job.requiredSkills) {
    if (!normalizedSkills.has(skill.toLowerCase())) missingRequirements.push(`Missing required skill: ${skill}.`);
  }

  for (const certification of job.requiredCertifications) {
    if (!hasValidCertification(certification, member.certifications, now)) {
      missingRequirements.push(`Missing or expired certification: ${certification}.`);
    }
  }

  const eligible = missingRequirements.length === 0;
  const window = eligible ? determineWindow(member) : "INELIGIBLE";
  const founderBonus = member.founderStatus === "NONE" ? 0 : 7;
  const tierBonus = { GROUNDED: 0, TRAINING: 1, SILVER: 3, GOLD: 6, PLATINUM: 10 }[member.tier];
  const rescueBonus = job.priority === "SAVE_THE_MISSION" ? Math.min(member.draftTokens, 3) : 0;
  const capacityPenalty = member.activeJobCount * 2;
  const rankScore = eligible ? round(member.haloScore + founderBonus + tierBonus + rescueBonus - capacityPenalty) : 0;

  if (eligible) {
    reasons.push(`${member.tier.replaceAll("_", " ")} member meets all job requirements.`);
    if (member.founderStatus !== "NONE") reasons.push("Founding Wing priority applies.");
    if (member.draftTokens > 0) reasons.push(`${member.draftTokens} Draft Token(s) available for tie-breaking.`);
  }

  return { eligible, window, rankScore, reasons, missingRequirements };
}
