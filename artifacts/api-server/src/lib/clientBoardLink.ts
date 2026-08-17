/**
 * Password-free Client Board links.
 *
 * Regional: client_portfolios.dashboard_token — every property in that portfolio.
 * Property: client_accounts.dashboard_token — that property only.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientOrgsTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  propertiesTable,
} from "@workspace/db";
import { loadTurnRef } from "./clientBoardRepo";
import { resolvePortfolioForProperty } from "./portfolioPulse";

export type ClientBoardLink = {
  kind: "regional" | "property";
  orgId: string;
  portfolioId: string;
  propertyId: string | null;
  allowedPropertyIds: string[] | null;
  viewLabel: string;
};

/**
 * A property-level board link has to work on its own.
 *
 * Everything portfolio-scoped (Pulse, attention, pipeline, cost-to-serve) resolves
 * through a portfolio, but a property that was never part of a regional rollout has
 * no org and no portfolio row — which used to make its whole board 404 "Invalid link".
 * So the first time such a board is opened we provision its own org + single-property
 * portfolio. Idempotent, serialized by an advisory lock, and it never touches a
 * property that already belongs to one.
 */
export async function ensurePortfolioForProperty(
  propertyId: string,
): Promise<{ portfolioId: string; orgId: string } | null> {
  const existing = await resolvePortfolioForProperty(propertyId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`client-board-portfolio:${propertyId}`}))`);

    const [property] = await tx
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        timezone: propertiesTable.timezone,
        clientOrgId: propertiesTable.clientOrgId,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);
    if (!property) return null;

    // Another request may have provisioned while we waited on the lock.
    const [claimed] = await tx
      .select({
        portfolioId: clientPortfolioPropertiesTable.portfolioId,
        orgId: clientPortfoliosTable.orgId,
      })
      .from(clientPortfolioPropertiesTable)
      .innerJoin(
        clientPortfoliosTable,
        eq(clientPortfoliosTable.id, clientPortfolioPropertiesTable.portfolioId),
      )
      .where(eq(clientPortfolioPropertiesTable.propertyId, propertyId))
      .limit(1);
    if (claimed) return { portfolioId: claimed.portfolioId, orgId: claimed.orgId };

    let orgId = property.clientOrgId;
    if (!orgId) {
      const slug = `property-${propertyId.slice(0, 8)}`;
      const [existingOrg] = await tx
        .select({ id: clientOrgsTable.id })
        .from(clientOrgsTable)
        .where(eq(clientOrgsTable.slug, slug))
        .limit(1);
      if (existingOrg) {
        orgId = existingOrg.id;
      } else {
        const [created] = await tx
          .insert(clientOrgsTable)
          .values({
            name: property.name,
            type: "pm_company",
            timezone: property.timezone ?? "America/Chicago",
            slug,
          })
          .returning({ id: clientOrgsTable.id });
        orgId = created!.id;
      }
      await tx
        .update(propertiesTable)
        .set({ clientOrgId: orgId })
        .where(eq(propertiesTable.id, propertyId));
    }

    const [existingPortfolio] = await tx
      .select({ id: clientPortfoliosTable.id })
      .from(clientPortfoliosTable)
      .where(eq(clientPortfoliosTable.orgId, orgId))
      .limit(1);
    const portfolioId =
      existingPortfolio?.id ??
      (
        await tx
          .insert(clientPortfoliosTable)
          .values({ orgId, name: property.name })
          .returning({ id: clientPortfoliosTable.id })
      )[0]!.id;

    await tx
      .insert(clientPortfolioPropertiesTable)
      .values({ portfolioId, propertyId })
      .onConflictDoNothing();

    return { portfolioId, orgId };
  });
}

export async function resolveClientBoardLink(token: string): Promise<ClientBoardLink | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const [portfolio] = await db
    .select({
      id: clientPortfoliosTable.id,
      orgId: clientPortfoliosTable.orgId,
      name: clientPortfoliosTable.name,
    })
    .from(clientPortfoliosTable)
    .where(and(eq(clientPortfoliosTable.dashboardToken, trimmed), isNotNull(clientPortfoliosTable.dashboardToken)))
    .limit(1);
  if (portfolio) {
    return {
      kind: "regional",
      orgId: portfolio.orgId,
      portfolioId: portfolio.id,
      propertyId: null,
      allowedPropertyIds: null,
      viewLabel: portfolio.name,
    };
  }

  const [account] = await db
    .select({
      propertyId: clientAccountsTable.propertyId,
      status: clientAccountsTable.status,
    })
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, trimmed))
    .limit(1);
  if (!account || account.status !== "active") return null;
  const resolved = await ensurePortfolioForProperty(account.propertyId);
  if (!resolved) return null;
  const [property] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, account.propertyId))
    .limit(1);
  return {
    kind: "property",
    orgId: resolved.orgId,
    portfolioId: resolved.portfolioId,
    propertyId: account.propertyId,
    allowedPropertyIds: [account.propertyId],
    viewLabel: property?.name ?? "Property",
  };
}

export function sessionSubjectForLink(link: ClientBoardLink): string {
  return link.kind === "regional" ? `r:${link.portfolioId}` : link.propertyId!;
}

export async function clientMayAccessProperty(
  token: string,
  propertyId: string,
): Promise<{ orgId: string } | null> {
  const link = await resolveClientBoardLink(token);
  if (!link) return null;
  if (link.kind === "property" && link.propertyId !== propertyId) return null;
  const target = await resolvePortfolioForProperty(propertyId);
  if (!target || target.portfolioId !== link.portfolioId || target.orgId !== link.orgId) return null;
  return { orgId: link.orgId };
}

export async function clientMayAccessTurn(
  token: string,
  turnId: string,
): Promise<{ orgId: string } | null> {
  const turn = await loadTurnRef(turnId);
  if (!turn) return null;
  return clientMayAccessProperty(token, turn.propertyId);
}

export type RegionalClientLink =
  | { ok: true; link: ClientBoardLink }
  | { ok: false; status: 403 | 404; error: string };

/** Pipeline, import, how-work, and add-property are regional-link only. */
export async function regionalClientLink(token: string): Promise<RegionalClientLink> {
  const link = await resolveClientBoardLink(token);
  if (!link) return { ok: false, status: 404, error: "Invalid link" };
  if (link.kind !== "regional") {
    return { ok: false, status: 403, error: "This view is for the regional portfolio" };
  }
  return { ok: true, link };
}
