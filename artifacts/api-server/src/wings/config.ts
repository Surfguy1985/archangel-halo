export interface FoundingWingsConfig {
  score: {
    lookbackDays: number;
    priorScore: number;
    priorWeight: number;
    staleAfterHours: number;
    thresholds: {
      grounded: number;
      training: number;
      silver: number;
      gold: number;
      platinum: number;
    };
  };
  overrides: {
    firstPeriodMonths: number;
    firstRate: number;
    secondPeriodMonths: number;
    secondRate: number;
    legacyRate: number;
    reservePercent: number;
    qualityBonusPercentOfReserve: number;
    minimumGrossProfitCents: number;
  };
  quality: {
    autoPassConfidence: number;
    autoFailCritical: boolean;
    maxImagesPerReview: number;
    defaultQualityWindowDays: number;
  };
  eligibility: {
    criticalIncidentSeverity: number;
    decisionTtlHours: number;
  };
  automation: {
    maxMembersPerRun: number;
    maxQualityReviewsPerRun: number;
    maxJobsPerRun: number;
    enableAiOperator: boolean;
  };
}

export const DEFAULT_CONFIG: FoundingWingsConfig = {
  score: {
    lookbackDays: 90,
    priorScore: 85,
    priorWeight: 3,
    staleAfterHours: 24,
    thresholds: {
      grounded: 0,
      training: 75,
      silver: 85,
      gold: 90,
      platinum: 95
    }
  },
  overrides: {
    firstPeriodMonths: 18,
    firstRate: 0.05,
    secondPeriodMonths: 36,
    secondRate: 0.03,
    legacyRate: 0.01,
    reservePercent: 0.2,
    qualityBonusPercentOfReserve: 0.05,
    minimumGrossProfitCents: 1000
  },
  quality: {
    autoPassConfidence: 0.78,
    autoFailCritical: false,
    maxImagesPerReview: 12,
    defaultQualityWindowDays: 14
  },
  eligibility: {
    criticalIncidentSeverity: 4,
    decisionTtlHours: 24
  },
  automation: {
    maxMembersPerRun: 500,
    maxQualityReviewsPerRun: 50,
    maxJobsPerRun: 100,
    enableAiOperator: true
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeConfig(base: FoundingWingsConfig, override: unknown): FoundingWingsConfig {
  if (!isObject(override)) return base;

  const merge = (left: unknown, right: unknown): unknown => {
    if (!isObject(left) || !isObject(right)) return right ?? left;
    const output: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      output[key] = key in output ? merge(output[key], value) : value;
    }
    return output;
  };

  return merge(base, override) as FoundingWingsConfig;
}


export function validateConfig(config: FoundingWingsConfig): FoundingWingsConfig {
  const rates = [config.overrides.firstRate, config.overrides.secondRate, config.overrides.legacyRate, config.overrides.reservePercent];
  if (rates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Override rates and reservePercent must be between 0 and 1.");
  }
  if (config.overrides.firstPeriodMonths < 0 || config.overrides.secondPeriodMonths <= config.overrides.firstPeriodMonths) {
    throw new Error("Override month periods are invalid.");
  }
  const t = config.score.thresholds;
  if (!(t.grounded <= t.training && t.training < t.silver && t.silver < t.gold && t.gold < t.platinum && t.platinum <= 100)) {
    throw new Error("Halo tier thresholds must be ordered from grounded through platinum.");
  }
  if (config.score.lookbackDays < 7 || config.score.lookbackDays > 730) throw new Error("lookbackDays must be between 7 and 730.");
  if (config.quality.autoPassConfidence < 0 || config.quality.autoPassConfidence > 1) throw new Error("autoPassConfidence must be between 0 and 1.");
  if (config.quality.maxImagesPerReview < 1 || config.quality.maxImagesPerReview > 40) throw new Error("maxImagesPerReview must be between 1 and 40.");
  return config;
}
