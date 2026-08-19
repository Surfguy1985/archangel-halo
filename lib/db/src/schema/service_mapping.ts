import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
export const serviceMappingTable = pgTable("service_mapping", {
  id: uuid("id").primaryKey().defaultRandom(), masterServiceCode: text("master_service_code").notNull(),
  crewServiceCode: text("crew_service_code").notNull(), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
