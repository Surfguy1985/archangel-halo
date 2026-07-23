export type WingTier = "GROUNDED" | "TRAINING" | "SILVER" | "GOLD" | "PLATINUM";

export type FounderStatus = "NONE" | "FOUNDING_WING" | "LEGACY";

export type CrewStatus = "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "INACTIVE";

export interface ScoreInput {
  inspectionScores: number[];
  customerRatings: number[];
  callbackCount: number;
  damageCount: number;
  completedJobCount: number;
  acceptedAssignmentCount: number;
  onTimeCount: number;
  onTimeMeasuredCount: number;
  attendedCount: number;
  attendanceMeasuredCount: number;
  communicationRatings: number[];
  professionalismRatings: number[];
  safetyScores: number[];
  safetyIncidentCount: number;
  activeQualityRecruitCount: number;
  completedRescueMissionCount: number;
}

export interface ScoreCategoryPoints {
  quality: number;
  reliability: number;
  professionalism: number;
  safety: number;
  team: number;
}

export interface ScoreResult {
  totalScore: number;
  tier: WingTier;
  confidence: number;
  points: ScoreCategoryPoints;
  sampleSize: number;
  reasons: string[];
}

export interface CertificationRecord {
  code: string;
  expiresAt?: string | null;
  verified?: boolean;
}

export interface EligibilityMemberInput {
  status: CrewStatus;
  founderStatus: FounderStatus;
  haloScore: number;
  tier: WingTier;
  tradeSkills: string[];
  certifications: CertificationRecord[];
  activeJobCount: number;
  maxConcurrentJobs: number;
  isAvailable: boolean;
  unresolvedCriticalIncidentCount: number;
  draftTokens: number;
}

export interface EligibilityJobInput {
  requiredHaloScore: number;
  requiredSkills: string[];
  requiredCertifications: string[];
  priority: "STANDARD" | "PREMIUM" | "FLAGSHIP" | "SAVE_THE_MISSION";
}

export type EligibilityWindow =
  | "PLATINUM_FIRST"
  | "GOLD_SECOND"
  | "FOUNDERS_THIRD"
  | "OPEN_FLIGHT"
  | "INELIGIBLE";

export interface EligibilityResult {
  eligible: boolean;
  window: EligibilityWindow;
  rankScore: number;
  reasons: string[];
  missingRequirements: string[];
}

export interface OverrideInput {
  allocatedGrossProfitCents: number;
  sponsorRelationshipMonths: number;
  recruitHaloScore: number;
  reservePercent: number;
}

export interface OverrideResult {
  baseRate: number;
  qualityMultiplier: number;
  grossOverrideCents: number;
  immediateAmountCents: number;
  reserveAmountCents: number;
}
