import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events, tickets } from '../db/schema/index.js';
import { redisClient } from '../config/redis.js';

export class HoldCleanupService {
  private timer: NodeJS.Timeout | null = null;
  public isRunning = false;

  start(intervalMs: number = 60000): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    this.cleanupExpiredHolds().catch((err) => {
      console.error('Error during initial hold cleanup:', err);
    });

    this.timer = setInterval(async () => {
      try {
        await this.cleanupExpiredHolds();
      } catch (err) {
        console.error('Error during scheduled hold cleanup:', err);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  async cleanupExpiredHolds(): Promise<number> {
    return await db.transaction(async (tx) => {
      const now = new Date();

      const expiredTickets = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.status, 'pending'), lt(tickets.holdExpiry, now)))
        .for('update', { skipLocked: true });

      if (!expiredTickets || expiredTickets.length === 0) {
        return 0;
      }

      for (const ticket of expiredTickets) {
        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, ticket.eventId))
          .for('update');

        if (event) {
          await tx
            .update(events)
            .set({
              availableTickets: event.availableTickets + ticket.quantity,
              updatedAt: new Date(),
            })
            .where(eq(events.id, event.id));
        }

        await tx
          .update(tickets)
          .set({
            status: 'expired',
            holdExpiry: null,
            updatedAt: new Date(),
          })
          .where(eq(tickets.id, ticket.id));

        await redisClient.invalidateEvent(ticket.eventId);
      }

      return expiredTickets.length;
    });
  }
}

export const holdCleanupService = new HoldCleanupService();
export default holdCleanupService;
