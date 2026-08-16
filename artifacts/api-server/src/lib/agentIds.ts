/** UUID property ids only — never pass token slugs into the metrics join. */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function propertyIdsForClock(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => UUID.test(id)))];
}
