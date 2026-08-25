import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const whatsappSessions = sqliteTable("whatsapp_sessions", {
  phone: text("phone").primaryKey(),
  stage: text("stage").notNull().default("start"),
  category: text("category"),
  searchResults: text("search_results").notNull().default("[]"),
  cart: text("cart").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull(),
});
