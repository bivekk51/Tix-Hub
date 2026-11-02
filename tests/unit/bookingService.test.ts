import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBooking,
  confirmBooking,
  cancelBooking,
  getUserBookings,
  getBookingById,
} from '../../src/modules/bookings/bookingService.js';
import {
  ConflictError,
  NotFoundError,
  AuthorizationError,
  ValidationError,
} from '../../src/utils/errors.js';
import { db } from '../../src/db/index.js';
import { redisClient } from '../../src/config/redis.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/redis.js', () => ({
  redisClient: {
    invalidateEvent: vi.fn().mockResolvedValue(true),
    del: vi.fn().mockResolvedValue(true),
  },
}));

describe('Booking Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBooking', () => {
    it('should throw ConflictError if requested quantity exceeds available tickets', async () => {
      const mockEvent = {
        id: 'event-1',
        name: 'Fest',
        price: '25.00',
        availableTickets: 2,
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockEvent]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(createBooking('event-1', 'user-1', 5)).rejects.toThrow(ConflictError);
      await expect(createBooking('event-1', 'user-1', 5)).rejects.toThrow('Only 2 tickets available');
    });

    it('should throw NotFoundError if event does not exist', async () => {
      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(createBooking('event-nonexistent', 'user-1', 2)).rejects.toThrow(NotFoundError);
      await expect(createBooking('event-nonexistent', 'user-1', 2)).rejects.toThrow('Event not found');
    });

    it('should throw ValidationError if parameters are invalid', async () => {
      await expect(createBooking('', 'user-1', 2)).rejects.toThrow(ValidationError);
      await expect(createBooking('event-1', '', 2)).rejects.toThrow(ValidationError);
      await expect(createBooking('event-1', 'user-1', 0)).rejects.toThrow(ValidationError);
      await expect(createBooking('event-1', 'user-1', -1)).rejects.toThrow(ValidationError);
    });

    it('should successfully hold tickets, decrement inventory, and invalidate cache', async () => {
      const mockEvent = {
        id: 'event-1',
        name: 'Fest',
        price: '25.00',
        availableTickets: 10,
        date: new Date(),
        location: 'Hall',
      };

      const mockTicket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-1',
        quantity: 2,
        totalPrice: '50.00',
        status: 'pending',
        holdExpiry: new Date(Date.now() + 600000),
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockEvent]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([mockTicket]),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await createBooking('event-1', 'user-1', 2);
      expect(result.id).toBe('ticket-1');
      expect(result.quantity).toBe(2);
      expect(result.status).toBe('pending');
      expect(redisClient.invalidateEvent).toHaveBeenCalledWith('event-1');
    });
  });

  describe('confirmBooking', () => {
    it('should throw ValidationError if ticketId or userId is missing', async () => {
      await expect(confirmBooking('', 'user-1')).rejects.toThrow(ValidationError);
      await expect(confirmBooking('ticket-1', '')).rejects.toThrow(ValidationError);
    });

    it('should throw ConflictError if hold has expired', async () => {
      const expiredTicket = {
        id: 'ticket-1',
        userId: 'user-1',
        status: 'pending',
        holdExpiry: new Date(Date.now() - 10000),
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([expiredTicket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow(ConflictError);
      await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow('Booking hold has expired');
    });

    it('should throw AuthorizationError if different user tries to confirm', async () => {
      const ticket = {
        id: 'ticket-1',
        userId: 'user-owner',
        status: 'pending',
        holdExpiry: new Date(Date.now() + 600000),
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([ticket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(confirmBooking('ticket-1', 'user-imposter')).rejects.toThrow(AuthorizationError);
    });

    it('should throw NotFoundError if booking does not exist', async () => {
      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(confirmBooking('nonexistent', 'user-1')).rejects.toThrow(NotFoundError);
      await expect(confirmBooking('nonexistent', 'user-1')).rejects.toThrow('Booking not found');
    });

    it('should throw ConflictError if booking status is not pending', async () => {
      const ticket = {
        id: 'ticket-1',
        userId: 'user-1',
        status: 'confirmed',
        holdExpiry: null,
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([ticket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow(ConflictError);
      await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow('Booking cannot be confirmed');
    });

    it('should confirm pending booking successfully with row locking and invalidate cache', async () => {
      const ticket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-1',
        status: 'pending',
        holdExpiry: new Date(Date.now() + 600000),
      };

      const confirmedTicket = {
        ...ticket,
        status: 'confirmed',
        holdExpiry: null,
      };

      const forMock = vi.fn().mockResolvedValue([ticket]);

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: forMock,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([confirmedTicket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await confirmBooking('ticket-1', 'user-1');
      expect(forMock).toHaveBeenCalledWith('update');
      expect(result.status).toBe('confirmed');
      expect(result.holdExpiry).toBeNull();
      expect(redisClient.invalidateEvent).toHaveBeenCalledWith('event-1');
    });
  });

  describe('cancelBooking', () => {
    it('should restore tickets and invalidate Redis cache on cancellation', async () => {
      const mockTicket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-1',
        quantity: 3,
        status: 'pending',
      };

      const mockEvent = {
        id: 'event-1',
        availableTickets: 5,
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValueOnce([mockTicket]).mockResolvedValueOnce([mockEvent]),
              }),
            }),
          })),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ ...mockTicket, status: 'cancelled' }]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await cancelBooking('ticket-1', 'user-1');
      expect(result.status).toBe('cancelled');
      expect(redisClient.invalidateEvent).toHaveBeenCalledWith('event-1');
    });

    it('should throw NotFoundError if booking does not exist on cancel', async () => {
      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(cancelBooking('ticket-1', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('should throw AuthorizationError if different user tries to cancel', async () => {
      const mockTicket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-owner',
        quantity: 2,
        status: 'pending',
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockTicket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(cancelBooking('ticket-1', 'user-imposter')).rejects.toThrow(AuthorizationError);
    });

    it('should throw ConflictError if booking is already cancelled', async () => {
      const mockTicket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-1',
        quantity: 2,
        status: 'cancelled',
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockTicket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(cancelBooking('ticket-1', 'user-1')).rejects.toThrow(ConflictError);
      await expect(cancelBooking('ticket-1', 'user-1')).rejects.toThrow(
        'Booking cannot be cancelled. Current status: cancelled'
      );
    });

    it('should throw ConflictError if attempting to cancel an expired booking', async () => {
      const mockTicket = {
        id: 'ticket-1',
        eventId: 'event-1',
        userId: 'user-1',
        quantity: 2,
        status: 'expired',
      };

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([mockTicket]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      await expect(cancelBooking('ticket-1', 'user-1')).rejects.toThrow(ConflictError);
      await expect(cancelBooking('ticket-1', 'user-1')).rejects.toThrow(
        'Booking cannot be cancelled. Current status: expired'
      );
    });
  });

  describe('getUserBookings', () => {
    it('should throw ValidationError if userId is missing', async () => {
      await expect(getUserBookings('')).rejects.toThrow(ValidationError);
    });

    it('should return bookings for the user', async () => {
      const mockBookings = [
        {
          id: 'ticket-1',
          quantity: 2,
          totalPrice: '50.00',
          status: 'confirmed',
          holdExpiry: null,
          createdAt: new Date(),
          event: {
            id: 'event-1',
            name: 'Concert',
            date: new Date(),
            location: 'Arena',
            price: '25.00',
          },
        },
      ];

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockBookings),
          }),
        }),
      });

      const result = await getUserBookings('user-1');
      expect(result).toEqual(mockBookings);
    });
  });

  describe('getBookingById', () => {
    it('should throw ValidationError if ticketId or userId is missing', async () => {
      await expect(getBookingById('', 'user-1')).rejects.toThrow(ValidationError);
      await expect(getBookingById('ticket-1', '')).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError if booking does not exist', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(getBookingById('ticket-1', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('should throw AuthorizationError if user does not own the booking', async () => {
      const mockBooking = {
        id: 'ticket-1',
        userId: 'user-owner',
        quantity: 2,
        totalPrice: '50.00',
        status: 'confirmed',
        holdExpiry: null,
        createdAt: new Date(),
        event: {
          id: 'event-1',
          name: 'Concert',
        },
      };

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockBooking]),
          }),
        }),
      });

      await expect(getBookingById('ticket-1', 'user-imposter')).rejects.toThrow(AuthorizationError);
    });

    it('should return booking details for the owner', async () => {
      const mockBooking = {
        id: 'ticket-1',
        userId: 'user-1',
        quantity: 2,
        totalPrice: '50.00',
        status: 'confirmed',
        holdExpiry: null,
        createdAt: new Date(),
        event: {
          id: 'event-1',
          name: 'Concert',
          date: new Date(),
          location: 'Arena',
          price: '25.00',
        },
      };

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockBooking]),
          }),
        }),
      });

      const result = await getBookingById('ticket-1', 'user-1');
      expect(result).toEqual(mockBooking);
    });
  });
});
