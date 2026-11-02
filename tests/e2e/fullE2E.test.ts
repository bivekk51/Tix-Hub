import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db, pool } from '../../src/db/index.js';
import { users, events, tickets } from '../../src/db/schema/index.js';
import { redisClient } from '../../src/config/redis.js';
import { holdCleanupService } from '../../src/services/holdCleanupService.js';
import { eq } from 'drizzle-orm';

describe('TIX-HUB Full End-to-End System Tests (PostgreSQL + Redis)', () => {
  let adminToken: string;
  let adminId: string;
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;

  beforeAll(async () => {
    // Connect to real Redis instance
    await redisClient.connect();
    expect(redisClient.isConnected).toBe(true);

    // Clean DB tables before starting
    await db.delete(tickets);
    await db.delete(events);
    await db.delete(users);
    if (redisClient.isConnected && redisClient.client) {
      await redisClient.client.flushAll();
    }
  });

  afterAll(async () => {
    // Clean up connections
    await redisClient.disconnect();
    await pool.end();
  });

  describe('1. System Health & Infrastructure', () => {
    it('GET / should report API running and Redis Connected', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cache).toBe('Connected');
    });

    it('GET /health should report all services healthy', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('healthy');
      expect(res.body.services.api).toBe('running');
      expect(res.body.services.database).toBe('connected');
      expect(res.body.services.cache).toBe('connected');
    });
  });

  describe('2. User Authentication & Authorization Flow', () => {
    it('should register a user and ignore mass-assignment of role: admin (SEC-01)', async () => {
      const res = await request(app)
        .post('/api/v1/users/register')
        .send({
          name: 'Super Admin',
          email: 'admin@tixhub.test',
          password: 'AdminPassword123!',
          role: 'admin', // Should be ignored by public register endpoint
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('admin@tixhub.test');
      expect(res.body.data.role).toBe('user'); // SEC-01 verified: public registration defaults to user
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data._id).toBe(res.body.data.id); // backward compatibility alias

      adminId = res.body.data.id;

      // Securely elevate to admin in database (as done via seeding/admin CLI)
      await db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId));

      // Login to get fresh admin JWT
      const loginRes = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: 'admin@tixhub.test',
          password: 'AdminPassword123!',
        });
      expect(loginRes.body.data.role).toBe('admin');
      adminToken = loginRes.body.data.token;
    });

    it('should reject duplicate user registration with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/v1/users/register')
        .send({
          name: 'Imposter Admin',
          email: 'admin@tixhub.test',
          password: 'AnotherPassword123!',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already exists');
    });

    it('should register regular customer users', async () => {
      const res1 = await request(app)
        .post('/api/v1/users/register')
        .send({
          name: 'Alice Fan',
          email: 'alice@tixhub.test',
          password: 'AlicePassword123!',
        });
      expect(res1.status).toBe(201);
      user1Token = res1.body.data.token;
      user1Id = res1.body.data.id;

      const res2 = await request(app)
        .post('/api/v1/users/register')
        .send({
          name: 'Bob Music',
          email: 'bob@tixhub.test',
          password: 'BobPassword123!',
        });
      expect(res2.status).toBe(201);
      user2Token = res2.body.data.token;
      user2Id = res2.body.data.id;
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: 'alice@tixhub.test',
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Invalid credentials');
    });

    it('should login successfully with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/users/login')
        .send({
          email: 'alice@tixhub.test',
          password: 'AlicePassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.id).toBe(user1Id);
      expect(res.body.data._id).toBe(user1Id);
    });
  });

  describe('3. Event Lifecycle & Caching Flow', () => {
    let eventId: string;

    it('should forbid regular user from creating an event', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Unauthorized Concert',
          description: 'User trying to create event',
          date: new Date(Date.now() + 86400000).toISOString(),
          location: 'Madison Square Garden',
          totalTickets: 100,
          price: 50.00,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('admin only');
    });

    it('should allow admin to create event and populate database & invalidate cache', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Grand Rock Festival 2026',
          description: 'An electrifying live rock experience featuring top bands.',
          date: new Date(Date.now() + 86400000 * 7).toISOString(),
          location: 'Olympic Arena, London',
          totalTickets: 10,
          price: 75.50,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Grand Rock Festival 2026');
      expect(res.body.data.totalTickets).toBe(10);
      expect(res.body.data.availableTickets).toBe(10);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data._id).toBe(res.body.data.id);

      eventId = res.body.data.id;

      // Verify row in PostgreSQL
      const [dbEvent] = await db.select().from(events).where(eq(events.id, eventId));
      expect(dbEvent).toBeDefined();
      expect(dbEvent.totalTickets).toBe(10);
      expect(dbEvent.availableTickets).toBe(10);
    });

    it('should test GET /api/v1/events with caching headers (MISS then HIT)', async () => {
      // First request -> Cache MISS
      const res1 = await request(app).get('/api/v1/events');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-cache']).toBe('MISS');
      expect(res1.body.data.length).toBeGreaterThan(0);

      // Second request -> Cache HIT from real Redis
      const res2 = await request(app).get('/api/v1/events');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-cache']).toBe('HIT');
      expect(res2.body.data[0].id).toBe(eventId);
    });

    it('should query event by ID with creator joined and cache headers', async () => {
      const res = await request(app).get(`/api/v1/events/${eventId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(eventId);
      expect(res.body.data._id).toBe(eventId);
      expect(res.body.data.createdBy.email).toBe('admin@tixhub.test');
      expect(res.body.data.createdBy._id).toBe(adminId);
    });

    it('should allow admin to update event and invalidate cache', async () => {
      const res = await request(app)
        .put(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Grand Rock Festival 2026 - Extended Tour',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Grand Rock Festival 2026 - Extended Tour');

      // Verify cached read now returns updated value
      const resGet = await request(app).get(`/api/v1/events/${eventId}`);
      expect(resGet.body.data.name).toBe('Grand Rock Festival 2026 - Extended Tour');
    });
  });

  describe('4. Ticket Booking Engine & Concurrency Control', () => {
    let testEventId: string;
    let aliceTicketId: string;
    let bobTicketId: string;

    beforeAll(async () => {
      // Create a fresh event with exactly 10 tickets for precision concurrency tests
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Exclusive VIP Show',
          description: 'Strictly limited capacity show',
          date: new Date(Date.now() + 86400000 * 2).toISOString(),
          location: 'Underground Club',
          totalTickets: 10,
          price: 100.00,
        });

      testEventId = res.body.data.id;
    });

    it('should allow Alice to hold 4 tickets, decreasing available stock to 6', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          eventId: testEventId,
          quantity: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quantity).toBe(4);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.totalPrice).toBe('400.00');
      expect(res.body.data.holdExpiry).toBeDefined();

      aliceTicketId = res.body.data.id;

      // Verify PostgreSQL available tickets updated
      const [ev] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(ev.availableTickets).toBe(6);
    });

    it('should allow Bob to hold 5 tickets, decreasing available stock to 1', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          eventId: testEventId,
          quantity: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.quantity).toBe(5);
      bobTicketId = res.body.data.id;

      // Verify PostgreSQL available tickets updated to 1
      const [ev] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(ev.availableTickets).toBe(1);
    });

    it('should reject booking 2 tickets when only 1 is available', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          eventId: testEventId,
          quantity: 2,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Only 1 tickets available');

      // Verify inventory untouched
      const [ev] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(ev.availableTickets).toBe(1);
    });

    it('should execute 5 concurrent simultaneous requests for the last 1 ticket: exactly 1 succeeds, 4 fail', async () => {
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({
            eventId: testEventId,
            quantity: 1,
          })
      );

      const responses = await Promise.all(requests);
      const successes = responses.filter(r => r.status === 201);
      const conflicts = responses.filter(r => r.status === 409);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(4);

      // Verify availableTickets reached 0 and never became negative
      const [ev] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(ev.availableTickets).toBe(0);
    });

    it('should prevent Bob from confirming Alice booking (AuthorizationError)', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${aliceTicketId}/confirm`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow Alice to confirm her pending booking', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${aliceTicketId}/confirm`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
      expect(res.body.data.holdExpiry).toBeNull();

      // Check DB row
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, aliceTicketId));
      expect(ticket.status).toBe('confirmed');
      expect(ticket.holdExpiry).toBeNull();
    });

    it('should reject confirming an already confirmed booking with 409 Conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${aliceTicketId}/confirm`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Current status: confirmed');
    });

    it('should allow Bob to cancel his pending booking and restore tickets to event pool', async () => {
      // Before cancellation, available tickets is 0
      const [beforeEv] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(beforeEv.availableTickets).toBe(0);

      const res = await request(app)
        .post(`/api/v1/bookings/${bobTicketId}/cancel`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('cancelled');

      // After cancellation, available tickets is 5
      const [afterEv] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(afterEv.availableTickets).toBe(5);

      // Verify cached event read immediately reflects the returned 5 tickets
      const eventRes = await request(app).get(`/api/v1/events/${testEventId}`);
      expect(eventRes.body.data.availableTickets).toBe(5);
    });

    it('should reject cancelling an already cancelled booking (no double-refund)', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${bobTicketId}/cancel`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Booking cannot be cancelled. Current status: cancelled');

      // Inventory must remain 5
      const [ev] = await db.select().from(events).where(eq(events.id, testEventId));
      expect(ev.availableTickets).toBe(5);
    });
  });

  describe('5. Expired Hold Background Cleanup Flow', () => {
    let expiredEventId: string;
    let expiredTicketId: string;

    beforeAll(async () => {
      // Create an event with 5 tickets
      const [ev] = await db.insert(events).values({
        name: 'Flash Sale Event',
        description: 'Testing hold expiration',
        date: new Date(Date.now() + 86400000),
        location: 'Virtual',
        totalTickets: 5,
        availableTickets: 2, // 3 held
        price: '20.00',
        createdBy: adminId,
      }).returning();
      expiredEventId = ev.id;

      // Insert an expired pending ticket directly (hold expired 5 minutes ago)
      const pastDate = new Date(Date.now() - 5 * 60 * 1000);
      const [t] = await db.insert(tickets).values({
        eventId: expiredEventId,
        userId: user1Id,
        quantity: 3,
        totalPrice: '60.00',
        status: 'pending',
        holdExpiry: pastDate,
      }).returning();
      expiredTicketId = t.id;
    });

    it('should reject confirming an expired hold with 409 Conflict', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${expiredTicketId}/confirm`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Booking hold has expired');
    });

    it('should execute hold cleanup service, restoring inventory and marking ticket expired', async () => {
      const count = await holdCleanupService.cleanupExpiredHolds();
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify ticket status is now 'expired'
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, expiredTicketId));
      expect(ticket.status).toBe('expired');
      expect(ticket.holdExpiry).toBeNull();

      // Verify event inventory restored from 2 to 5
      const [ev] = await db.select().from(events).where(eq(events.id, expiredEventId));
      expect(ev.availableTickets).toBe(5);
    });

    it('should reject cancelling an expired ticket (preventing phantom duplicate inventory)', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${expiredTicketId}/cancel`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Booking cannot be cancelled. Current status: expired');

      // Verify inventory was NOT incremented again
      const [ev] = await db.select().from(events).where(eq(events.id, expiredEventId));
      expect(ev.availableTickets).toBe(5);
    });
  });

  describe('6. User Bookings Query', () => {
    it('should list all bookings for the authenticated user with event details', async () => {
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].event).toBeDefined();
      expect(res.body.data[0].id).toBeDefined();
      expect(res.body.data[0]._id).toBe(res.body.data[0].id);
      expect(res.body.data[0].event._id).toBe(res.body.data[0].event.id);
    });
  });
});
