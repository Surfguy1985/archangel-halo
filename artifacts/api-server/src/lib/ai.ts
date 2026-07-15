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

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function completeJsonWithImage<T = unknown>(
  system: string,
  user: string,
  imageBase64: string,
  mediaType: ImageMediaType,
  maxTokens = 8192,
): Promise<T> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: `${system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: user },
        ],
      },
    ],
  });
  return extractJson(textOf(message as never)) as T;
}
