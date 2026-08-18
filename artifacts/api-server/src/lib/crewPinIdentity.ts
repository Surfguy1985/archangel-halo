/**
 * The four things a crew pin must say, resolved once on the server.
 *
 * Six different maps show crew pins (two office Pulse maps, the command
 * center, and three client surfaces). They read two different endpoints, so
 * anything derived in the browser gets derived six slightly different ways —
 * which is how we ended up with pins that show a trade on one map, a unit on
 * another, and a company on none. Name, unit, service and contractor are
 * decided here and shipped ready to render.
 */

/** Shown when the business hasn't named itself in settings yet. */
export const DEFAULT_CONTRACTOR = "Archangel Contractors";

/**
 * Who the crew works for. A sub carries its own company name; anyone without
 * one is ours, and wears the business's name from settings.
 */
export function contractorLabel(
  crewCompany: string | null | undefined,
  inHouseName: string | null | undefined,
): string {
  const sub = crewCompany?.trim();
  if (sub) return sub;
  return inHouseName?.trim() || DEFAULT_CONTRACTOR;
}

/**
 * One short line naming the work being done. Prefers what is still open —
 * that's what the crew is there for right now — then anything on the job, then
 * the job's own description, and finally the crew's trade. Null when the crew
 * has no work attached at all, so callers render a fallback instead of the
 * word "undefined".
 */
export function serviceLabel(input: {
  services?: { service: string | null; done: boolean }[];
  jobDescription?: string | null;
  trade?: string | null;
}): string | null {
  const named = (input.services ?? []).filter((s) => s.service?.trim());
  const open = named.find((s) => !s.done) ?? named[0];
  if (open?.service) {
    const rest = named.length - 1;
    return rest > 0 ? `${open.service.trim()} +${rest}` : open.service.trim();
  }
  const desc = input.jobDescription?.trim();
  if (desc) return desc.length > 60 ? `${desc.slice(0, 57)}…` : desc;
  return input.trade?.trim() || null;
}
