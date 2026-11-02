import { pgTable, uuid, varchar, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

export const events = pgTable(
  'events',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    location: varchar('location', { length: 255 }).notNull(),
    totalTickets: integer('total_tickets').notNull(),
    availableTickets: integer('available_tickets').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dateIdx: index('events_date_idx').on(table.date),
  })
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
