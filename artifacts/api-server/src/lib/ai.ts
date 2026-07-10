import { anthropic } from "@workspace/integrations-anthropic-ai";

const MODEL = "claude-sonnet-4-6";

function textOf(message: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

export async function completeText(
  system: string,
  user: string,
  maxTokens = 8192,
): Promise<string> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return textOf(message as never);
}

function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const firstBrace = s.search(/[[{]/);
  if (firstBrace > 0) s = s.slice(firstBrace);
  return JSON.parse(s);
}

export async function completeJson<T = unknown>(
  system: string,
  user: string,
  maxTokens = 8192,
): Promise<T> {
  const raw = await completeText(
    `${system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`,
    user,
    maxTokens,
  );
  return extractJson(raw) as T;
}
