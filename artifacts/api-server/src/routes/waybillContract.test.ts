/**
 * Contract tests: every board/feed endpoint variant must ship every card with
 * a `waybillCode` (FLK tracking code) and a valid `waybill.stages` strip.
 *
 * Both fields are REQUIRED in the API spec — a serializer that forgets them
 * fails zod parsing server-side and 500s the whole board. These tests seed a
 * throwaway property + client account + cards in the dev database, hit the
 * real express app, and assert the contract on every variant:
 *
 *   - client board GET (vendor)            /client/:token/board
 *   - client board GET (pm)                /client/:token/board/pm
 *   - office board full                    /admin/accounts/:pid/board/full
 *   - client feed                          /client/:token/board/feed
 *   - office feed                          /admin/accounts/:pid/board
 *   - card update response                 PATCH /client/:token/board/feed/cards/:id
 *   - card action response                 POST /client/:token/board/cards/:id/action
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientAccountsTable,
  clientUsersTable,
  clientBoardCardsTable,
  clientDashboardCardsTable,
} from "@workspace/db";
import app from "../app";
import { issueSessionToken } from "./clientBoard";
import { waybillCodeFor } from "../lib/waybill";

const FLK_RE = /^FLK-[0-9A-HJKMNP-TV-Z]{5}$/;
const STAGE_ORDER = ["sealed", "routed", "delivered", "opened", "in_review", "settled"];

type AnyCard = Record<string, unknown>;

/** The contract every shipped card must satisfy, on every endpoint. */
function expectWaybill(card: AnyCard, where: string) {
  expect(card.waybillCode, `${where}: card ${card.id ?? card.cardKey} missing waybillCode`).toMatch(FLK_RE);
  const waybill = card.waybill as { stages?: Array<{ stage: string; at: string }>; holder?: string } | undefined;
  expect(waybill, `${where}: card missing waybill`).toBeTruthy();
  const stages = waybill!.stages ?? [];
  expect(stages.length, `${where}: waybill.stages empty`).toBeGreaterThan(0);
  expect(stages.map((s) => s.stage)).toEqual(STAGE_ORDER.slice(0, stages.length));
  for (const s of stages) {
    expect(Number.isNaN(new Date(s.at).getTime()), `${where}: bad stage timestamp`).toBe(false);
  }
  expect(["sender", "network", "recipient", "done"]).toContain(waybill!.holder);
}

const token = `wbtest-${randomUUID()}`;
let propertyId = "";
let cardId = "";
let userId = "";
let sessionCookie = "";

beforeAll(async () => {
  const [prop] = await db
    .insert(propertiesTable)
    .values({ name: "Waybill Contract Test Property" })
    .returning();
  propertyId = prop!.id;
  await db.insert(clientAccountsTable).values({
    propertyId,
    dashboardToken: token,
    status: "active",
  });
  const [user] = await db
    .insert(clientUsersTable)
    .values({
      propertyId,
      name: "Waybill Tester",
      email: `waybill-test-${randomUUID()}@example.com`,
      role: "admin",
      passwordHash: "unused:unused",
    })
    .returning();
  userId = user!.id;
  const [card] = await db
    .insert(clientBoardCardsTable)
    .values({
      propertyId,
      column: "inbox",
      kind: "manual",
      title: "Contract test card",
      sourceType: "manual",
      sourceId: `wbtest-${randomUUID()}`,
    })
    .returning();
  cardId = card!.id;
  // A custom PM-board card so the pm variant has at least one card to check.
  await db.insert(clientDashboardCardsTable).values({
    propertyId,
    cardKey: `custom:${randomUUID()}`,
    kind: "custom",
    board: "pm",
    lane: "planning",
    title: "PM contract test card",
  });
  // Strict cookie mode: state-changing requests need the session cookie the
  // dashboard mints via the token exchange on load.
  const exchange = await request(app).post(`/api/client/${token}/session`);
  expect(exchange.status).toBe(204);
  sessionCookie = (exchange.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;
  expect(sessionCookie).toContain("halo_client_session=");
});

afterAll(async () => {
  await db.delete(clientBoardCardsTable).where(eq(clientBoardCardsTable.propertyId, propertyId));
  await db.delete(clientDashboardCardsTable).where(eq(clientDashboardCardsTable.propertyId, propertyId));
  await db.delete(clientUsersTable).where(eq(clientUsersTable.propertyId, propertyId));
  await db.delete(clientAccountsTable).where(eq(clientAccountsTable.propertyId, propertyId));
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
});

describe("board waybill contract", () => {
  it("client board GET (vendor) ships waybills on every card", async () => {
    const res = await request(app).get(`/api/client/${token}/board`);
    expect(res.status).toBe(200);
    const cards = res.body.cards as AnyCard[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expectWaybill(c, "vendor board");
    // The projected pushed card must carry the SAME code as the raw feed
    // card — i.e. the "push:" prefix was stripped before hashing.
    const pushed = cards.find((c) => c.cardKey === `push:${cardId}`);
    expect(pushed, "seeded card not projected onto the vendor board").toBeTruthy();
    expect(pushed!.waybillCode).toBe(waybillCodeFor(cardId));
  });

  it("client board GET (pm) ships waybills on every card", async () => {
    const res = await request(app).get(`/api/client/${token}/board/pm`);
    expect(res.status).toBe(200);
    const cards = res.body.cards as AnyCard[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expectWaybill(c, "pm board");
  });

  it("office board full ships waybills on every card", async () => {
    const res = await request(app).get(`/api/admin/accounts/${propertyId}/board/full`);
    expect(res.status).toBe(200);
    const cards = res.body.board.cards as AnyCard[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expectWaybill(c, "office full board");
  });

  it("client feed ships waybills on every card", async () => {
    const res = await request(app).get(`/api/client/${token}/board/feed`);
    expect(res.status).toBe(200);
    const cards = res.body.cards as AnyCard[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expectWaybill(c, "client feed");
    expect((cards.find((c) => c.id === cardId) ?? {}).waybillCode).toBe(waybillCodeFor(cardId));
  });

  it("office feed ships waybills on every card", async () => {
    const res = await request(app).get(`/api/admin/accounts/${propertyId}/board`);
    expect(res.status).toBe(200);
    const cards = res.body.cards as AnyCard[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expectWaybill(c, "office feed");
  });

  it("card update (feed PATCH) response ships the waybill", async () => {
    const res = await request(app)
      .patch(`/api/client/${token}/board/feed/cards/${cardId}`)
      .set("Cookie", sessionCookie)
      .send({ column: "todo" });
    expect(res.status).toBe(200);
    expectWaybill(res.body as AnyCard, "feed card PATCH");
    // Moving the card must advance the strip past "sealed".
    const stages = (res.body.waybill.stages as Array<{ stage: string }>).map((s) => s.stage);
    expect(stages).toContain("delivered");
  });

  it("card action response ships the waybill (and lights 'opened')", async () => {
    const res = await request(app)
      .post(`/api/client/${token}/board/cards/${cardId}/action`)
      .set("Cookie", sessionCookie)
      .set("Authorization", `Bearer ${issueSessionToken(userId)}`)
      .send({ action: "acknowledge" });
    expect(res.status, `action failed: ${JSON.stringify(res.body)}`).toBe(200);
    // Module-less cards must stay module-less — a bare { acknowledgedAt }
    // module has no `type` and would violate the discriminated union.
    expect(res.body.module).toBeNull();
    expectWaybill(res.body as AnyCard, "card action");
    const stages = (res.body.waybill.stages as Array<{ stage: string }>).map((s) => s.stage);
    expect(stages).toContain("opened");
  });
});
