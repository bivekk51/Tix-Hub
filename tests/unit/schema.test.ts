import { describe, it, expect } from 'vitest';
import {
  userRoleEnum,
  ticketStatusEnum,
  users,
  events,
  tickets,
  usersRelations,
  eventsRelations,
  ticketsRelations,
} from '../../src/db/schema';
import { db, pool } from '../../src/db';

describe('Drizzle Schemas', () => {
  it('should have all expected status values in ticketStatusEnum including expired', () => {
    expect(ticketStatusEnum.enumValues).toEqual(['pending', 'confirmed', 'cancelled', 'expired']);
  });

  it('should have all expected role values in userRoleEnum', () => {
    expect(userRoleEnum.enumValues).toEqual(['user', 'admin']);
  });

  it('should export valid table definitions with primary key id', () => {
    expect(users.id).toBeDefined();
    expect(events.id).toBeDefined();
    expect(tickets.id).toBeDefined();
    expect(tickets.holdExpiry).toBeDefined();
  });

  it('should export valid relations for all tables', () => {
    expect(usersRelations).toBeDefined();
    expect(eventsRelations).toBeDefined();
    expect(ticketsRelations).toBeDefined();
  });

  it('should export db and pool instances', () => {
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
  });
});
