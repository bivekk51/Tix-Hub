import { describe, it, expect, vi, beforeEach } from 'vitest';
import { holdCleanupService } from '../../src/services/holdCleanupService.js';
import { db } from '../../src/db/index.js';
import { redisClient } from '../../src/config/redis.js';

vi.mock('../../src/db/index.js', () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/redis.js', () => ({
  redisClient: {
    invalidateEvent: vi.fn().mockResolvedValue(true),
  },
}));

describe('Hold Cleanup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process expired ticket holds and restore event inventory', async () => {
    const expiredTickets = [
      { id: 'ticket-1', eventId: 'event-1', quantity: 2 },
    ];
    const event = { id: 'event-1', availableTickets: 10 };

    (db.transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValueOnce(expiredTickets).mockResolvedValueOnce([event]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      return await callback(tx);
    });

    const released = await holdCleanupService.cleanupExpiredHolds();
    expect(released).toBe(1);
    expect(redisClient.invalidateEvent).toHaveBeenCalledWith('event-1');
  });

  it('should return 0 when no tickets have expired', async () => {
    (db.transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        }),
      };
      return await callback(tx);
    });

    const released = await holdCleanupService.cleanupExpiredHolds();
    expect(released).toBe(0);
  });

  it('should start and stop cleanup timer', () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.spyOn(holdCleanupService, 'cleanupExpiredHolds').mockResolvedValue(0);

    holdCleanupService.start(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(2);

    holdCleanupService.stop();
    vi.advanceTimersByTime(2000);
    expect(cleanupSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
