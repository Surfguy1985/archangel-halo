import { anthropic } from "@workspace/integrations-anthropic-ai";

const MODEL = "claude-sonnet-4-6";
/** Claude's most capable model — used for complex reasoning paths (SOP rules, invoice audit, voice parsing). Do NOT pass temperature/top_p/top_k with this model. */
export const COMPLEX_MODEL = "claude-opus-4-7";

/** Retry transient AI-provider failures (rate limits, overloads, 5xx). */
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const transient =
        status === 429 || (typeof status === "number" && status >= 500) || status === undefined;
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

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
  model: string = MODEL,
): Promise<string> {
  const message = await withRetries(() =>
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  );
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
  model: string = MODEL,
): Promise<T> {
  const raw = await completeText(
    `${system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`,
    user,
    maxTokens,
    model,
  );
  return extractJson(raw) as T;
}

/** completeJson on Claude's most capable model — for complex multi-step reasoning. */
export async function completeComplexJson<T = unknown>(
  system: string,
  user: string,
  maxTokens = 8192,
): Promise<T> {
  return completeJson<T>(system, user, maxTokens, COMPLEX_MODEL);
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

/** Multi-image variant — labels each image so prompts can reference them (e.g. before/after sets). */
export async function completeJsonWithImages<T = unknown>(
  system: string,
  user: string,
  images: { label: string; base64: string; mediaType: Exclude<ImageMediaType, "application/pdf"> }[],
  maxTokens = 8192,
  model: string = MODEL,
): Promise<T> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: Exclude<ImageMediaType, "application/pdf">; data: string } }
  > = [];
  for (const img of images) {
    content.push({ type: "text", text: img.label });
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    });
  }
  content.push({ type: "text", text: user });
  const run = async (): Promise<T> => {
    const message = await withRetries(() =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: `${system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`,
        messages: [{ role: "user", content }],
      }),
    );
    return extractJson(textOf(message as never)) as T;
  };
  try {
    return await run();
  } catch {
    return await run();
  }
}

export async function completeJsonWithImage<T = unknown>(
  system: string,
  user: string,
  imageBase64: string,
  mediaType: ImageMediaType,
  maxTokens = 8192,
  model: string = MODEL,
): Promise<T> {
  const run = async (): Promise<T> => {
    const message = await withRetries(() =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: `${system}\n\nRespond with ONLY valid JSON. No prose, no markdown fences.`,
        messages: [
          {
            role: "user",
            content: [
              mediaType === "application/pdf"
                ? {
                    type: "document" as const,
                    source: { type: "base64" as const, media_type: "application/pdf" as const, data: imageBase64 },
                  }
                : {
                    type: "image" as const,
                    source: { type: "base64" as const, media_type: mediaType, data: imageBase64 },
                  },
              { type: "text", text: user },
            ],
          },
        ],
      }),
    );
    return extractJson(textOf(message as never)) as T;
  };
  try {
    return await run();
  } catch {
    // One full retry — covers malformed/truncated JSON on the first pass.
    return await run();
  }
}
