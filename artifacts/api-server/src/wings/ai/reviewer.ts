import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const MODEL = "claude-opus-4-7";

export const QualityReviewResultSchema = z.object({
  recommendedStatus: z.enum(["PASS", "NEEDS_REVIEW", "FAIL"]),
  completenessScore: z.number().min(0).max(100),
  craftsmanshipScore: z.number().min(0).max(100),
  propertyProtectionScore: z.number().min(0).max(100),
  safetyScore: z.number().min(0).max(100),
  anomalyRisk: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  criticalConcern: z.boolean(),
  summary: z.string().min(1).max(1200),
  concerns: z.array(z.string().max(300)).max(12),
  evidence: z.object({
    visibleCompletionSignals: z.array(z.string().max(300)).max(12),
    missingEvidence: z.array(z.string().max(300)).max(12),
    possibleDuplicateOrMismatchedImages: z.array(z.string().max(300)).max(12),
  }),
});

export type AIQualityReviewResult = z.infer<typeof QualityReviewResultSchema>;

export type EvidenceImage = {
  stage: "BEFORE" | "AFTER";
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI returned no JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function reviewQualityEvidence(input: {
  job: { name: string; description?: string | null };
  notes?: string | null;
  images: EvidenceImage[];
  maxImages: number;
}): Promise<AIQualityReviewResult> {
  const images = input.images.slice(0, input.maxImages);
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [
    {
      type: "text",
      text: JSON.stringify({
        job: input.job,
        notes: input.notes ?? null,
        imageStages: images.map((img, i) => ({
          image: i + 1,
          stage: img.stage,
        })),
      }),
    },
    ...images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType,
        data: img.base64,
      },
    })),
  ];

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      "You are Archangel Contractors' quality-control reviewer.",
      "Evaluate only visible and supplied evidence. Never invent hidden defects or certify code compliance from a photo.",
      "Compare before and after evidence; detect incomplete areas, mismatched stages, reused images, damage, unsafe practices, and missing proof.",
      "PASS requires strong evidence and no material concern. NEEDS_REVIEW is required when evidence is ambiguous, incomplete, or low-confidence, or could affect pay or discipline.",
      "FAIL is a recommendation only for clear, material failure. Human review policy may still override it.",
      "Respond ONLY with a JSON object with keys: recommendedStatus (PASS|NEEDS_REVIEW|FAIL), completenessScore (0-100), craftsmanshipScore (0-100), propertyProtectionScore (0-100), safetyScore (0-100), anomalyRisk (0-1), confidence (0-1), criticalConcern (boolean), summary (string), concerns (string[]), evidence ({visibleCompletionSignals: string[], missingEvidence: string[], possibleDuplicateOrMismatchedImages: string[]}).",
    ].join(" "),
    messages: [{ role: "user", content: content as never }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
  return QualityReviewResultSchema.parse(extractJson(text));
}
