/**
 * Password-free Client Board links.
 *
 * Regional: client_portfolios.dashboard_token — every property in that portfolio.
 * Property: client_accounts.dashboard_token — that property only.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  clientPortfoliosTable,
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
  const resolved = await resolvePortfolioForProperty(account.propertyId);
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
