import { pgTable, uuid, integer, numeric, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';

export const ticketStatusEnum = pgEnum('ticket_status', ['pending', 'confirmed', 'cancelled', 'expired']);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    eventId: uuid('event_id').references(() => events.id).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    quantity: integer('quantity').notNull(),
    totalPrice: numeric('total_price', { precision: 10, scale: 2 }).notNull(),
    status: ticketStatusEnum('status').default('pending').notNull(),
    holdExpiry: timestamp('hold_expiry', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    holdExpiryIdx: index('tickets_hold_expiry_idx').on(table.holdExpiry),
    eventUserIdx: index('tickets_event_user_idx').on(table.eventId, table.userId),
  })
);

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
