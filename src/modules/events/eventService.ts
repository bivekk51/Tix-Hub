import { eq, gte, ilike, and, asc, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { events, users } from '../../db/schema/index.js';
import { redisClient } from '../../config/redis.js';
import { NotFoundError, AuthorizationError, ValidationError } from '../../utils/errors.js';
import { CreateEventInput, UpdateEventInput, EventQueryInput } from './eventValidator.js';

export const createEvent = async (data: CreateEventInput, userId: string) => {
  if (!userId) {
    throw new ValidationError('User ID is required');
  }

  const priceValue = typeof data.price === 'number' ? data.price.toFixed(2) : String(data.price);

  const [event] = await db
    .insert(events)
    .values({
      name: data.name,
      description: data.description,
      date: new Date(data.date),
      location: data.location,
      totalTickets: data.totalTickets,
      availableTickets: data.totalTickets,
      price: priceValue,
      createdBy: userId,
    })
    .returning();

  await redisClient.delPattern('events:*');

  return event;
};

export const getAllEvents = async (filters: EventQueryInput = {}) => {
  const dateKey = filters.date || '';
  const locationKey = filters.location || '';
  const cacheKey = `events:list:${dateKey}|${locationKey}`;

  const cachedEvents = await redisClient.get<any[]>(cacheKey);
  if (cachedEvents) {
    return cachedEvents;
  }

  const conditions: SQL[] = [];

  if (filters.date) {
    const filterDate = new Date(filters.date);
    if (isNaN(filterDate.getTime())) {
      throw new ValidationError('Invalid date format');
    }
    conditions.push(gte(events.date, filterDate));
  }

  if (filters.location) {
    conditions.push(ilike(events.location, `%${filters.location}%`));
  }

  const baseQuery = db
    .select({
      id: events.id,
      name: events.name,
      description: events.description,
      date: events.date,
      location: events.location,
      totalTickets: events.totalTickets,
      availableTickets: events.availableTickets,
      price: events.price,
      createdBy: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
    })
    .from(events)
    .leftJoin(users, eq(events.createdBy, users.id));

  const results = conditions.length > 0
    ? await baseQuery.where(and(...conditions)).orderBy(asc(events.date))
    : await baseQuery.orderBy(asc(events.date));

  await redisClient.set(cacheKey, results, 300);

  return results;
};

export const getEventById = async (id: string) => {
  if (!id) {
    throw new ValidationError('Event ID is required');
  }

  const cacheKey = `event:${id}`;
  const cachedEvent = await redisClient.get<any>(cacheKey);
  if (cachedEvent) {
    return cachedEvent;
  }

  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      description: events.description,
      date: events.date,
      location: events.location,
      totalTickets: events.totalTickets,
      availableTickets: events.availableTickets,
      price: events.price,
      createdBy: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
    })
    .from(events)
    .leftJoin(users, eq(events.createdBy, users.id))
    .where(eq(events.id, id));

  if (!rows || rows.length === 0) {
    throw new NotFoundError('Event not found');
  }

  const event = rows[0];
  await redisClient.set(cacheKey, event, 1800);

  return event;
};

export const updateEvent = async (
  id: string,
  updateData: UpdateEventInput,
  userId: string,
  userRole: string
) => {
  if (!id || !userId) {
    throw new ValidationError('Event ID and User ID are required');
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(eq(events.id, id));

  if (!existing) {
    throw new NotFoundError('Event not found');
  }

  if (userRole !== 'admin' && existing.createdBy !== userId) {
    throw new AuthorizationError('Not authorized to update this event');
  }

  const updateValues: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (updateData.name !== undefined) updateValues.name = updateData.name;
  if (updateData.description !== undefined) updateValues.description = updateData.description;
  if (updateData.date !== undefined) updateValues.date = new Date(updateData.date);
  if (updateData.location !== undefined) updateValues.location = updateData.location;
  if (updateData.totalTickets !== undefined) updateValues.totalTickets = updateData.totalTickets;
  if (updateData.price !== undefined) {
    updateValues.price = typeof updateData.price === 'number'
      ? updateData.price.toFixed(2)
      : String(updateData.price);
  }

  const [updatedEvent] = await db
    .update(events)
    .set(updateValues)
    .where(eq(events.id, id))
    .returning();

  await redisClient.invalidateEvent(id);

  return updatedEvent;
};

export const deleteEvent = async (
  id: string,
  userId: string,
  userRole: string
) => {
  if (!id || !userId) {
    throw new ValidationError('Event ID and User ID are required');
  }

  const [existing] = await db
    .select()
    .from(events)
    .where(eq(events.id, id));

  if (!existing) {
    throw new NotFoundError('Event not found');
  }

  if (userRole !== 'admin' && existing.createdBy !== userId) {
    throw new AuthorizationError('Not authorized to delete this event');
  }

  await db.delete(events).where(eq(events.id, id));

  await redisClient.invalidateEvent(id);

  return { message: 'Event deleted successfully' };
};
