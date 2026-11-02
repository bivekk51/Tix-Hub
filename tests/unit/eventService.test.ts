import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEvent, getAllEvents, getEventById, updateEvent, deleteEvent } from '../../src/modules/events/eventService.js';
import { NotFoundError, AuthorizationError, ValidationError } from '../../src/utils/errors.js';
import { db } from '../../src/db/index.js';
import { redisClient } from '../../src/config/redis.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/config/redis.js', () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(true),
    invalidateEvent: vi.fn().mockResolvedValue(true),
    invalidateEventLists: vi.fn().mockResolvedValue(true),
    delPattern: vi.fn().mockResolvedValue(true),
  },
}));

describe('Event Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEventById', () => {
    it('should throw NotFoundError if event does not exist on getEventById', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(getEventById('123e4567-e89b-12d3-a456-426614174000')).rejects.toThrow(NotFoundError);
    });

    it('should return cached event if available in Redis', async () => {
      const cached = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Cached Concert',
      };
      (redisClient.get as any).mockResolvedValueOnce(cached);

      const result = await getEventById('123e4567-e89b-12d3-a456-426614174000');
      expect(result).toEqual(cached);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache if not in Redis', async () => {
      const mockEvent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'DB Concert',
        createdBy: { id: 'u1', name: 'User 1', email: 'u1@example.com' },
      };
      (redisClient.get as any).mockResolvedValueOnce(null);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockEvent]),
          }),
        }),
      });

      const result = await getEventById('123e4567-e89b-12d3-a456-426614174000');
      expect(result).toEqual(mockEvent);
      expect(redisClient.set).toHaveBeenCalledWith(
        'event:123e4567-e89b-12d3-a456-426614174000',
        mockEvent,
        1800
      );
    });
  });

  describe('createEvent', () => {
    it('should create an event, set availableTickets = totalTickets, and bust cache', async () => {
      const mockEventData = {
        name: 'Summer Concert',
        description: 'A great open air concert',
        date: '2026-12-01T20:00:00.000Z',
        location: 'Stadium',
        totalTickets: 100,
        price: 50.00,
      };

      const mockCreated = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...mockEventData,
        availableTickets: 100,
        price: '50.00',
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockCreated]),
        }),
      });

      const result = await createEvent(mockEventData, 'user-1');
      expect(result.id).toBe(mockCreated.id);
      expect(result.availableTickets).toBe(100);
      expect(redisClient.invalidateEventLists).toHaveBeenCalled();
    });

    it('should throw ValidationError if userId is missing', async () => {
      const mockEventData = {
        name: 'Summer Concert',
        description: 'A great open air concert',
        date: '2026-12-01T20:00:00.000Z',
        location: 'Stadium',
        totalTickets: 100,
        price: 50.0,
      };

      await expect(createEvent(mockEventData, '' as any)).rejects.toThrow(ValidationError);
    });
  });

  describe('getAllEvents', () => {
    it('should return cached events if available in Redis', async () => {
      const cached = [{ id: '1', name: 'Event 1' }];
      (redisClient.get as any).mockResolvedValueOnce(cached);

      const result = await getAllEvents({});
      expect(result).toEqual(cached);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('should query DB and cache results on cache miss', async () => {
      const mockEvents = [{ id: '1', name: 'Event 1' }];
      (redisClient.get as any).mockResolvedValueOnce(null);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(mockEvents),
            }),
            orderBy: vi.fn().mockResolvedValue(mockEvents),
          }),
        }),
      });

      const result = await getAllEvents({});
      expect(result).toEqual(mockEvents);
      expect(redisClient.set).toHaveBeenCalled();
    });
  });

  describe('updateEvent', () => {
    it('should throw AuthorizationError if non-admin and non-creator tries to update event', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: '123e4567-e89b-12d3-a456-426614174000',
            createdBy: 'creator-user-id',
          }]),
        }),
      });

      await expect(updateEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        { name: 'Hacked' },
        'stranger-user-id',
        'user'
      )).rejects.toThrow(AuthorizationError);
    });

    it('should throw NotFoundError if event does not exist', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await expect(updateEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        { name: 'Updated' },
        'creator-user-id',
        'user'
      )).rejects.toThrow(NotFoundError);
    });

    it('should allow admin or creator to update event and invalidate cache', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: '123e4567-e89b-12d3-a456-426614174000',
            createdBy: 'creator-user-id',
          }]),
        }),
      });

      const mockUpdated = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Name',
        createdBy: 'creator-user-id',
      };

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdated]),
          }),
        }),
      });

      const result = await updateEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        { name: 'Updated Name' },
        'creator-user-id',
        'user'
      );

      expect(result).toEqual(mockUpdated);
      expect(redisClient.invalidateEvent).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000');
    });
  });

  describe('deleteEvent', () => {
    it('should throw AuthorizationError if non-admin and non-creator tries to delete event', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: '123e4567-e89b-12d3-a456-426614174000',
            createdBy: 'creator-user-id',
          }]),
        }),
      });

      await expect(deleteEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        'stranger-user-id',
        'user'
      )).rejects.toThrow(AuthorizationError);
    });

    it('should throw NotFoundError if event does not exist on delete', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      await expect(deleteEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        'user-1',
        'admin'
      )).rejects.toThrow(NotFoundError);
    });

    it('should delete event and invalidate cache when authorized', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: '123e4567-e89b-12d3-a456-426614174000',
            createdBy: 'creator-user-id',
          }]),
        }),
      });

      (db.delete as any).mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      });

      const result = await deleteEvent(
        '123e4567-e89b-12d3-a456-426614174000',
        'admin-user-id',
        'admin'
      );

      expect(result).toEqual({ message: 'Event deleted successfully' });
      expect(redisClient.invalidateEvent).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000');
    });
  });
});
