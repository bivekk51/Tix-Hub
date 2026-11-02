import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { events, tickets } from '../../db/schema/index.js';
import {
  NotFoundError,
  ConflictError,
  AuthorizationError,
  ValidationError,
} from '../../utils/errors.js';
import { redisClient } from '../../config/redis.js';
import { env } from '../../config/env.js';

export const createBooking = async (
  eventId: string,
  userId: string,
  quantity: number
) => {
  if (!eventId || !userId || quantity === undefined || quantity === null) {
    throw new ValidationError('Event ID, User ID, and quantity are required');
  }

  if (quantity <= 0) {
    throw new ValidationError('Quantity must be greater than 0');
  }

  return await db.transaction(async (tx) => {
    // 1. Lock event row to guarantee atomicity under concurrent requests
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update');

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    if (event.availableTickets < quantity) {
      throw new ConflictError(`Only ${event.availableTickets} tickets available`);
    }

    // 2. Decrement inventory
    await tx
      .update(events)
      .set({
        availableTickets: event.availableTickets - quantity,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    // 3. Insert pending ticket hold
    const holdDuration = env.HOLD_DURATION_MS || 10 * 60 * 1000;
    const holdExpiry = new Date(Date.now() + holdDuration);
    const totalPrice = (Number(event.price) * quantity).toFixed(2);

    const [ticket] = await tx
      .insert(tickets)
      .values({
        eventId,
        userId,
        quantity,
        totalPrice,
        status: 'pending',
        holdExpiry,
      })
      .returning();

    // 4. Invalidate caches
    await redisClient.invalidateEvent(eventId);

    return {
      ...ticket,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        location: event.location,
        price: event.price,
      },
    };
  });
};

export const confirmBooking = async (ticketId: string, userId: string) => {
  if (!ticketId || !userId) {
    throw new ValidationError('Booking ID and User ID are required');
  }

  return await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for('update');

    if (!ticket) {
      throw new NotFoundError('Booking not found');
    }

    if (ticket.userId !== userId) {
      throw new AuthorizationError('Not authorized to confirm this booking');
    }

    if (ticket.status !== 'pending') {
      throw new ConflictError(
        `Booking cannot be confirmed. Current status: ${ticket.status}`
      );
    }

    if (ticket.holdExpiry && new Date() > new Date(ticket.holdExpiry)) {
      throw new ConflictError('Booking hold has expired');
    }

    const [confirmed] = await tx
      .update(tickets)
      .set({
        status: 'confirmed',
        holdExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId))
      .returning();

    await redisClient.invalidateEvent(ticket.eventId);

    return confirmed;
  });
};

export const cancelBooking = async (ticketId: string, userId: string) => {
  if (!ticketId || !userId) {
    throw new ValidationError('Booking ID and User ID are required');
  }

  return await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for('update');

    if (!ticket) {
      throw new NotFoundError('Booking not found');
    }

    if (ticket.userId !== userId) {
      throw new AuthorizationError('Not authorized to cancel this booking');
    }

    if (ticket.status !== 'pending' && ticket.status !== 'confirmed') {
      throw new ConflictError(
        `Booking cannot be cancelled. Current status: ${ticket.status}`
      );
    }

    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, ticket.eventId))
      .for('update');

    if (!event) {
      throw new NotFoundError('Associated event not found');
    }

    // Return tickets to pool
    await tx
      .update(events)
      .set({
        availableTickets: event.availableTickets + ticket.quantity,
        updatedAt: new Date(),
      })
      .where(eq(events.id, event.id));

    const [cancelled] = await tx
      .update(tickets)
      .set({
        status: 'cancelled',
        holdExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, ticketId))
      .returning();

    // Invalidate event cache
    await redisClient.invalidateEvent(ticket.eventId);

    return cancelled;
  });
};

export const getUserBookings = async (userId: string) => {
  if (!userId) {
    throw new ValidationError('User ID is required');
  }

  return await db
    .select({
      id: tickets.id,
      quantity: tickets.quantity,
      totalPrice: tickets.totalPrice,
      status: tickets.status,
      holdExpiry: tickets.holdExpiry,
      createdAt: tickets.createdAt,
      event: {
        id: events.id,
        name: events.name,
        date: events.date,
        location: events.location,
        price: events.price,
      },
    })
    .from(tickets)
    .leftJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.userId, userId));
};

export const getBookingById = async (ticketId: string, userId: string) => {
  if (!ticketId || !userId) {
    throw new ValidationError('Booking ID and User ID are required');
  }

  const [booking] = await db
    .select({
      id: tickets.id,
      userId: tickets.userId,
      quantity: tickets.quantity,
      totalPrice: tickets.totalPrice,
      status: tickets.status,
      holdExpiry: tickets.holdExpiry,
      createdAt: tickets.createdAt,
      event: {
        id: events.id,
        name: events.name,
        date: events.date,
        location: events.location,
        price: events.price,
      },
    })
    .from(tickets)
    .leftJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.id, ticketId));

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  if (booking.userId !== userId) {
    throw new AuthorizationError('Not authorized to view this booking');
  }

  return booking;
};
