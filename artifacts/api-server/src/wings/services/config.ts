import { db, wingConfigTable } from "@workspace/db";
import {
  DEFAULT_CONFIG,
  mergeConfig,
  validateConfig,
  type FoundingWingsConfig,
} from "../config";

export async function getWingConfig(): Promise<FoundingWingsConfig> {
  const rows = await db.select().from(wingConfigTable).limit(1);
  if (!rows.length) return DEFAULT_CONFIG;
  try {
    return validateConfig(mergeConfig(DEFAULT_CONFIG, rows[0].config));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setWingConfig(
  override: unknown,
): Promise<FoundingWingsConfig> {
  const merged = validateConfig(mergeConfig(DEFAULT_CONFIG, override));
  const rows = await db.select().from(wingConfigTable).limit(1);
  if (rows.length) {
    const { eq } = await import("drizzle-orm");
    await db
      .update(wingConfigTable)
      .set({ config: override as object, updatedAt: new Date() })
      .where(eq(wingConfigTable.id, rows[0].id));
  } else {
    await db.insert(wingConfigTable).values({ config: override as object });
  }
  return merged;
}
