import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';
import { tickets } from './tickets.js';

export * from './users.js';
export * from './events.js';
export * from './tickets.js';

export const usersRelations = relations(users, ({ many }) => ({
  events: many(events),
  tickets: many(tickets),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  creator: one(users, { fields: [events.createdBy], references: [users.id] }),
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  event: one(events, { fields: [tickets.eventId], references: [events.id] }),
  user: one(users, { fields: [tickets.userId], references: [users.id] }),
}));
