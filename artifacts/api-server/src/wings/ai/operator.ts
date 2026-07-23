import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const MODEL = "claude-sonnet-4-6";

export const OperatorBriefSchema = z.object({
  executiveSummary: z.string().min(1).max(1500),
  risks: z
    .array(
      z.object({
        severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
        title: z.string(),
        detail: z.string(),
      }),
    )
    .max(12),
  recommendedActions: z
    .array(
      z.object({
        priority: z.number().int().min(1).max(100),
        action: z.string(),
        reason: z.string(),
      }),
    )
    .max(20),
  celebration: z.array(z.string()).max(8),
});

export type OperatorBrief = z.infer<typeof OperatorBriefSchema>;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI returned no JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function createOperatorBrief(
  snapshot: unknown,
): Promise<OperatorBrief> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: [
      "You are HALO's Founding Wings operations chief for Archangel Contractors.",
      "Analyze the supplied program snapshot and create a concise operating brief.",
      "Do not invent data. Do not recommend changing compensation for protected traits or subjective personality judgments.",
      "Prioritize quality, safety, customer commitments, fair access, reserve risk, and recognizing excellent work.",
      "The deterministic HALO rules engine—not you—makes final eligibility and money decisions.",
      "Respond ONLY with a JSON object with keys: executiveSummary (string), risks (array of {severity: LOW|MEDIUM|HIGH, title, detail}), recommendedActions (array of {priority: 1-100 integer, action, reason}), celebration (string[]).",
    ].join(" "),
    messages: [{ role: "user", content: JSON.stringify(snapshot) }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
  return OperatorBriefSchema.parse(extractJson(text));
}
