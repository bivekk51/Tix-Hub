# TypeScript, PostgreSQL & Drizzle ORM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port TIX-HUB backend from CommonJS/MongoDB to TypeScript/PostgreSQL with Drizzle ORM, fix active bugs, and establish robust concurrency control for ticket holds.

**Architecture:** Express application rewritten in strict TypeScript (ESM) following a modular layered architecture. PostgreSQL serves as the relational persistent store with Drizzle ORM providing transactional concurrency control (`SELECT ... FOR UPDATE`), while Redis provides query response caching, rate limiting, and temporary hold tracking.

**Tech Stack:** Node.js 22, TypeScript, Express, PostgreSQL, Drizzle ORM, Drizzle Kit, `pg`, Redis (`node-redis` v4), Zod, `drizzle-zod`, Vitest, Supertest, `tsup`, `tsx`.

**Spec:** [`docs/superpowers/specs/2026-11-02-ts-postgres-drizzle-migration-design.md`](file:///home/bivss/development/personal/backendAPI/docs/superpowers/specs/2026-11-02-ts-postgres-drizzle-migration-design.md)

---

## Global Constraints

- **Language & Runtime:** TypeScript 5+ targeting Node 22 (ESM, strict mode enabled).
- **Database & ORM:** PostgreSQL accessed strictly through Drizzle ORM and `pg` pool; no Mongoose or MongoDB artifacts remaining.
- **Concurrency & Holds:** All inventory alterations must occur within transactions; ticket holds last 10 minutes with `hold_expiry` timestamp.
- **Bug Fixes:** 
  - `ticket_status` enum includes `'pending'`, `'confirmed'`, `'cancelled'`, and `'expired'`.
  - Redis client must use `socket: { host, port }` configuration with resilient offline fallbacks.
  - Booking cancellations must invalidate both `availability:${eventId}` and `event:${eventId}` caches.
  - User model hooks must not mix async functions with `next()` callbacks.
- **API Compatibility:** All JSON responses envelope output as `{ success: true, data: ... }` with primary key `id` and aliased `_id: id`.

---

## Review Focus

1. **Concurrent Overselling Defense:** When two concurrent requests attempt to reserve the last available ticket (`availableTickets = 1`), exactly one must succeed (201) and the second must receive `ConflictError` (409) without negative inventory.
2. **Expired Hold Confirmation Rejection:** Attempting to confirm a booking after its 10-minute hold window expires must fail with `ConflictError` (409) and message `'Booking hold has expired'`.
3. **Cancellation Cache Busting:** Cancelling a booking must immediately bust the cached event details and availability keys in Redis so subsequent reads reflect restored inventory.
4. **API Backward Compatibility:** Every entity serializer must output both `id` and `_id` so legacy Postman tests and frontend integrations function seamlessly.
5. **Redis Offline Resilience:** When Redis connection drops, Express endpoints must continue serving requests directly against PostgreSQL rather than crashing or hanging.

---

## Task Breakdown

### Task 1: TypeScript Tooling, Project Dependencies, and Environment Config

**Files:**
- Create: `tsconfig.json`
- Create: `drizzle.config.ts`
- Create: `.env.example`
- Create: `src/config/env.ts`
- Modify: `package.json`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: `process.env`
- Produces: `env` object validated via Zod (`PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `REDIS_HOST`, `REDIS_PORT`, `HOLD_DURATION_MS`).

- [ ] **Step 1: Write failing test for environment configuration validation**

```typescript
// tests/unit/env.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { validateEnv } from '../../src/config/env';

describe('Environment Configuration', () => {
  it('should parse valid environment variables', () => {
    const rawEnv = {
      DATABASE_URL: 'postgres://user:pass@localhost:5432/tixhub',
      JWT_SECRET: 'supersecretjwtkeythatislongenough',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
    };
    const parsed = validateEnv(rawEnv);
    expect(parsed.DATABASE_URL).toBe(rawEnv.DATABASE_URL);
    expect(parsed.PORT).toBe(5000); // default
  });

  it('should throw an error when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/env.test.ts`  
Expected: FAIL (cannot find module or `validateEnv` not defined)

- [ ] **Step 3: Update `package.json`, install dependencies, and configure TypeScript & Drizzle**

Update `package.json`:
- `"type": "module"`
- Scripts: `"build": "tsup src/server.ts --format esm --dts"`, `"dev": "tsx watch src/server.ts"`, `"test": "vitest run"`, `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:push": "drizzle-kit push"`
- Dependencies: `drizzle-orm`, `pg`, `zod`, `drizzle-zod`, `bcryptjs`, `jsonwebtoken`, `express`, `dotenv`, `redis`
- Dev Dependencies: `typescript`, `@types/node`, `@types/pg`, `@types/express`, `@types/bcryptjs`, `@types/jsonwebtoken`, `@types/supertest`, `tsx`, `tsup`, `vitest`, `supertest`, `drizzle-kit`

Write `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Write `drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tixhub',
  },
});
```

Write `src/config/env.ts`:
```typescript
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 chars'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  HOLD_DURATION_MS: z.coerce.number().default(10 * 60 * 1000),
});

export const validateEnv = (input: Record<string, unknown> = process.env) => envSchema.parse(input);
export const env = validateEnv(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/env.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add package.json tsconfig.json drizzle.config.ts .env.example src/config/env.ts tests/unit/env.test.ts
git commit -m "chore: setup typescript, drizzle config, and validated environment configuration"
```

---

### Task 2: Drizzle Database Schemas and Connection Pool

**Files:**
- Create: `src/db/schema/users.ts`
- Create: `src/db/schema/events.ts`
- Create: `src/db/schema/tickets.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/index.ts`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: `src/config/env.ts`
- Produces: `db` (Drizzle client instance), `users`, `events`, `tickets`, `userRoleEnum`, `ticketStatusEnum` schema objects and inferred TypeScript types (`User`, `NewUser`, `Event`, `NewEvent`, `Ticket`, `NewTicket`).

- [ ] **Step 1: Write test for Drizzle schema definitions and enums**

```typescript
// tests/unit/schema.test.ts
import { describe, it, expect } from 'vitest';
import { userRoleEnum, ticketStatusEnum, users, events, tickets } from '../../src/db/schema';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schema.test.ts`  
Expected: FAIL (cannot find module `../../src/db/schema`)

- [ ] **Step 3: Implement database schema tables and connection pool**

Write `src/db/schema/users.ts`:
```typescript
import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  password: varchar('password', { length: 255 }).notNull(),
  role: userRoleEnum('role').default('user').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

Write `src/db/schema/events.ts`:
```typescript
import { pgTable, uuid, varchar, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const events = pgTable('events', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  location: varchar('location', { length: 255 }).notNull(),
  totalTickets: integer('total_tickets').notNull(),
  availableTickets: integer('available_tickets').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
```

Write `src/db/schema/tickets.ts`:
```typescript
import { pgTable, uuid, integer, numeric, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { events } from './events';

export const ticketStatusEnum = pgEnum('ticket_status', ['pending', 'confirmed', 'cancelled', 'expired']);

export const tickets = pgTable('tickets', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  eventId: uuid('event_id').references(() => events.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  quantity: integer('quantity').notNull(),
  totalPrice: numeric('total_price', { precision: 10, scale: 2 }).notNull(),
  status: ticketStatusEnum('status').default('pending').notNull(),
  holdExpiry: timestamp('hold_expiry', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  holdExpiryIdx: index('tickets_hold_expiry_idx').on(table.holdExpiry),
  eventUserIdx: index('tickets_event_user_idx').on(table.eventId, table.userId),
}));

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
```

Write `src/db/schema/index.ts`:
```typescript
import { relations } from 'drizzle-orm';
import { users } from './users';
import { events } from './events';
import { tickets } from './tickets';

export * from './users';
export * from './events';
export * from './tickets';

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
```

Write `src/db/index.ts`:
```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schema.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/db/ tests/unit/schema.test.ts
git commit -m "feat(db): define PostgreSQL tables, relations, and Drizzle client instance"
```

---

### Task 3: Utilities, Response Serializer, Error Handling & Resilient Redis Client

**Files:**
- Create: `src/utils/errors.ts`
- Create: `src/utils/response.ts`
- Create: `src/middleware/error.ts`
- Create: `src/config/redis.ts`
- Create: `src/middleware/auth.ts`
- Test: `tests/unit/response.test.ts`
- Test: `tests/unit/error.test.ts`

**Interfaces:**
- Consumes: `src/config/env.ts`
- Produces: `AppError` hierarchy, `serializeEntity` helper, `errorHandler`, `asyncHandler`, `redisClient` singleton, `protect`, `adminOnly`.

- [ ] **Step 1: Write tests for response serialization and error mapping**

```typescript
// tests/unit/response.test.ts
import { describe, it, expect } from 'vitest';
import { serializeEntity } from '../../src/utils/response';

describe('Response Serialization', () => {
  it('should include both id and alias _id for backward compatibility', () => {
    const entity = { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Rock Fest' };
    const serialized = serializeEntity(entity);
    expect(serialized.id).toBe(entity.id);
    expect(serialized._id).toBe(entity.id);
    expect(serialized.name).toBe('Rock Fest');
  });

  it('should handle null or non-object values gracefully', () => {
    expect(serializeEntity(null)).toBeNull();
  });
});
```

```typescript
// tests/unit/error.test.ts
import { describe, it, expect } from 'vitest';
import { NotFoundError, ConflictError, ValidationError } from '../../src/utils/errors';

describe('Custom Errors', () => {
  it('should have correct status codes', () => {
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError('conflict').statusCode).toBe(409);
    expect(new ValidationError('invalid').statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/response.test.ts tests/unit/error.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement errors, serializer, error middleware, and resilient Redis client**

Write `src/utils/errors.ts`:
```typescript
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) { super(message, 400); }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') { super(message, 401); }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') { super(message, 403); }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') { super(message, 404); }
}

export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409); }
}
```

Write `src/utils/response.ts`:
```typescript
import { Response } from 'express';

export const serializeEntity = <T extends Record<string, any>>(entity: T | null): (T & { _id?: string }) | null => {
  if (!entity || typeof entity !== 'object') return entity;
  if ('id' in entity && !('_id' in entity)) {
    return { ...entity, _id: entity.id };
  }
  return entity;
};

export const sendSuccess = (res: Response, statusCode: number, data: any, message = 'Success') => {
  const serialized = Array.isArray(data) 
    ? data.map(item => serializeEntity(item))
    : serializeEntity(data);

  return res.status(statusCode).json({
    success: true,
    message,
    data: serialized,
  });
};
```

Write `src/middleware/error.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors: any = null;

  if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
  } else if (err.code === '23505') { // Postgres unique violation
    statusCode = 409;
    message = 'Resource already exists';
  } else if (err.code === '23503') { // Postgres foreign key violation
    statusCode = 400;
    message = 'Referenced resource does not exist';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

Write `src/config/redis.ts` (using resilient `socket: { host, port }` with graceful offline fallback):
```typescript
import { createClient } from 'redis';
import { env } from './env';

class RedisClient {
  public client: ReturnType<typeof createClient> | null = null;
  public isConnected = false;

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          reconnectStrategy: (retries) => (retries > 5 ? new Error('Redis max retries reached') : Math.min(retries * 100, 1000)),
        },
      });

      this.client.on('ready', () => { this.isConnected = true; });
      this.client.on('error', (err) => { this.isConnected = false; });
      this.client.on('end', () => { this.isConnected = false; });

      await this.client.connect();
    } catch (err) {
      this.isConnected = false;
      return null;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.client) return null;
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttl = 3600): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      await this.client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  async del(key: string | string[]): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch {
      return false;
    }
  }

  async delPattern(pattern: string): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) await this.client.del(keys);
      return true;
    } catch {
      return false;
    }
  }

  async invalidateEvent(eventId: string) {
    await Promise.all([
      this.del(`event:${eventId}`),
      this.del(`availability:${eventId}`),
      this.delPattern('events:*'),
      this.delPattern('route:/api/v1/events*'),
    ]);
  }
}

export const redisClient = new RedisClient();
```

Write `src/middleware/auth.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AuthenticationError, AuthorizationError } from '../utils/errors';
import { asyncHandler } from './error';
import { redisClient } from '../config/redis';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Not authorized, no token provided');
  }

  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, env.JWT_SECRET) as { id: string };

  let user = await redisClient.get<AuthUser>(`user:${decoded.id}`);
  if (!user) {
    const [dbUser] = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    }).from(users).where(eq(users.id, decoded.id));

    if (!dbUser) throw new AuthenticationError('User not found');
    user = dbUser;
    await redisClient.set(`user:${decoded.id}`, user, 3600);
  }

  req.user = user;
  next();
});

export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  throw new AuthorizationError('Access denied, admin only');
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/response.test.ts tests/unit/error.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/utils/ src/middleware/error.ts src/middleware/auth.ts src/config/redis.ts tests/unit/
git commit -m "feat: implement error handling, response serializer with id/_id alias, auth, and resilient redis client"
```

---

### Task 4: User Module (Registration, Login, Service, Controller & Routes)

**Files:**
- Create: `src/modules/users/userValidator.ts`
- Create: `src/modules/users/userService.ts`
- Create: `src/modules/users/userController.ts`
- Create: `src/modules/users/userRoutes.ts`
- Test: `tests/unit/userService.test.ts`

**Interfaces:**
- Consumes: `src/db`, `src/db/schema/users`, `src/utils/errors`, `src/config/env`
- Produces: `registerUser(data)`, `loginUser(email, password)`, `userRoutes` Express router.

- [ ] **Step 1: Write unit tests for User Service**

```typescript
// tests/unit/userService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUser, loginUser } from '../../src/modules/users/userService';
import { ConflictError, AuthenticationError } from '../../src/utils/errors';
import { db } from '../../src/db';
import bcrypt from 'bcryptjs';

vi.mock('../../src/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

describe('User Service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should throw ConflictError if user email already exists', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'existing-id', email: 'test@example.com' }]),
      }),
    });

    await expect(registerUser({
      name: 'Test',
      email: 'test@example.com',
      password: 'password123',
    })).rejects.toThrow(ConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/userService.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement User module files**

Write `src/modules/users/userValidator.ts`:
```typescript
import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  role: z.enum(['user', 'admin']).optional().default('user'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

Write `src/modules/users/userService.ts`:
```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users, NewUser } from '../../db/schema/users';
import { ConflictError, AuthenticationError } from '../../utils/errors';
import { env } from '../../config/env';
import { RegisterInput } from './userValidator';

const generateToken = (id: string): string => {
  return jwt.sign({ id }, env.JWT_SECRET, { expiresIn: '30d' });
};

export const registerUser = async (data: RegisterInput) => {
  const [existing] = await db.select().from(users).where(eq(users.email, data.email.toLowerCase()));
  if (existing) {
    throw new ConflictError('User already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(data.password, salt);

  const [newUser] = await db.insert(users).values({
    name: data.name,
    email: data.email.toLowerCase(),
    password: hashedPassword,
    role: data.role || 'user',
  }).returning({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
  });

  return {
    ...newUser,
    token: generateToken(newUser.id),
  };
};

export const loginUser = async (email: string, pass: string) => {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  const isMatch = await bcrypt.compare(pass, user.password);
  if (!isMatch) {
    throw new AuthenticationError('Invalid credentials');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token: generateToken(user.id),
  };
};
```

Write `src/modules/users/userController.ts`:
```typescript
import { Request, Response } from 'express';
import { registerUser, loginUser } from './userService';
import { registerSchema, loginSchema } from './userValidator';
import { asyncHandler } from '../../middleware/error';
import { sendSuccess } from '../../utils/response';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const validated = registerSchema.parse(req.body);
  const user = await registerUser(validated);
  return sendSuccess(res, 201, user, 'User registered successfully');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const validated = loginSchema.parse(req.body);
  const user = await loginUser(validated.email, validated.password);
  return sendSuccess(res, 200, user, 'Login successful');
});
```

Write `src/modules/users/userRoutes.ts`:
```typescript
import { Router } from 'express';
import { register, login } from './userController';

export const userRoutes = Router();
userRoutes.post('/register', register);
userRoutes.post('/login', login);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/userService.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/users/ tests/unit/userService.test.ts
git commit -m "feat(users): implement user registration, login, and authentication routes"
```

---

### Task 5: Event Module (CRUD, Filtering, Caching & Routes)

**Files:**
- Create: `src/modules/events/eventValidator.ts`
- Create: `src/modules/events/eventService.ts`
- Create: `src/modules/events/eventController.ts`
- Create: `src/modules/events/eventRoutes.ts`
- Create: `src/middleware/cache.ts`
- Test: `tests/unit/eventService.test.ts`

**Interfaces:**
- Consumes: `src/db`, `src/db/schema/events`, `src/config/redis`
- Produces: `createEvent`, `getAllEvents`, `getEventById`, `updateEvent`, `deleteEvent`, `eventRoutes`.

- [ ] **Step 1: Write unit tests for Event Service**

```typescript
// tests/unit/eventService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEvent, getEventById } from '../../src/modules/events/eventService';
import { NotFoundError } from '../../src/utils/errors';
import { db } from '../../src/db';
import { redisClient } from '../../src/config/redis';

vi.mock('../../src/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../../src/config/redis', () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(true),
    invalidateEvent: vi.fn().mockResolvedValue(true),
    delPattern: vi.fn().mockResolvedValue(true),
  },
}));

describe('Event Service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should throw NotFoundError if event does not exist in DB or cache', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(getEventById('123e4567-e89b-12d3-a456-426614174000')).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eventService.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement cache middleware and Event module**

Write `src/middleware/cache.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';

export const cacheMiddleware = (ttl = 300, keyGenerator?: (req: Request) => string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();

    const cacheKey = keyGenerator ? keyGenerator(req) : `route:${req.originalUrl || req.url}`;
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.status(200).json(cachedData);
    }

    const originalJson = res.json.bind(res);
    res.json = (data: any) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redisClient.set(cacheKey, data, ttl).catch(() => {});
      }
      res.set('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
};
```

Write `src/modules/events/eventValidator.ts`:
```typescript
import { z } from 'zod';

export const createEventSchema = z.object({
  name: z.string().min(3).max(255),
  description: z.string().min(10),
  date: z.string().datetime().or(z.date()),
  location: z.string().min(3).max(255),
  totalTickets: z.number().int().min(1).max(1000000),
  price: z.number().min(0).max(1000000),
});

export const updateEventSchema = createEventSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

export const eventQuerySchema = z.object({
  date: z.string().optional(),
  location: z.string().optional(),
});
```

Write `src/modules/events/eventService.ts`:
```typescript
import { eq, and, gte, ilike } from 'drizzle-orm';
import { db } from '../../db';
import { events, users } from '../../db/schema';
import { NotFoundError, AuthorizationError } from '../../utils/errors';
import { redisClient } from '../../config/redis';

export const createEvent = async (data: any, userId: string) => {
  const [event] = await db.insert(events).values({
    ...data,
    date: new Date(data.date),
    price: data.price.toFixed(2),
    availableTickets: data.totalTickets,
    createdBy: userId,
  }).returning();

  await redisClient.delPattern('events:*');
  return event;
};

export const getAllEvents = async (filters: { date?: string; location?: string } = {}) => {
  const cacheKey = `events:list:${filters.date || 'all'}|${filters.location?.toLowerCase() || 'all'}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return cached;

  const conditions = [];
  if (filters.date) conditions.push(gte(events.date, new Date(filters.date)));
  if (filters.location) conditions.push(ilike(events.location, `%${filters.location}%`));

  const result = await db.select({
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
  })
  .from(events)
  .leftJoin(users, eq(events.createdBy, users.id))
  .where(conditions.length > 0 ? and(...conditions) : undefined);

  await redisClient.set(cacheKey, result, 300);
  return result;
};

export const getEventById = async (id: string) => {
  const cached = await redisClient.get(`event:${id}`);
  if (cached) return cached;

  const [event] = await db.select({
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
  })
  .from(events)
  .leftJoin(users, eq(events.createdBy, users.id))
  .where(eq(events.id, id));

  if (!event) throw new NotFoundError('Event not found');

  await redisClient.set(`event:${id}`, event, 1800);
  return event;
};

export const updateEvent = async (id: string, updateData: any, userId: string, role: string) => {
  const [existing] = await db.select().from(events).where(eq(events.id, id));
  if (!existing) throw new NotFoundError('Event not found');

  if (role !== 'admin' && existing.createdBy !== userId) {
    throw new AuthorizationError('Not authorized to update this event');
  }

  const [updated] = await db.update(events)
    .set({
      ...updateData,
      date: updateData.date ? new Date(updateData.date) : undefined,
      price: updateData.price ? updateData.price.toFixed(2) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();

  await redisClient.invalidateEvent(id);
  return updated;
};

export const deleteEvent = async (id: string, userId: string, role: string) => {
  const [existing] = await db.select().from(events).where(eq(events.id, id));
  if (!existing) throw new NotFoundError('Event not found');

  if (role !== 'admin' && existing.createdBy !== userId) {
    throw new AuthorizationError('Not authorized to delete this event');
  }

  await db.delete(events).where(eq(events.id, id));
  await redisClient.invalidateEvent(id);
  return { message: 'Event deleted successfully' };
};
```

Write `src/modules/events/eventController.ts`:
```typescript
import { Request, Response } from 'express';
import { createEvent, getAllEvents, getEventById, updateEvent, deleteEvent } from './eventService';
import { createEventSchema, updateEventSchema, eventQuerySchema } from './eventValidator';
import { asyncHandler } from '../../middleware/error';
import { sendSuccess } from '../../utils/response';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const validated = createEventSchema.parse(req.body);
  const event = await createEvent(validated, req.user!.id);
  return sendSuccess(res, 201, event, 'Event created successfully');
});

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const query = eventQuerySchema.parse(req.query);
  const eventList = await getAllEvents(query);
  return sendSuccess(res, 200, eventList);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const event = await getEventById(req.params.id);
  return sendSuccess(res, 200, event);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateEventSchema.parse(req.body);
  const event = await updateEvent(req.params.id, validated, req.user!.id, req.user!.role);
  return sendSuccess(res, 200, event, 'Event updated successfully');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const result = await deleteEvent(req.params.id, req.user!.id, req.user!.role);
  return sendSuccess(res, 200, result);
});
```

Write `src/modules/events/eventRoutes.ts`:
```typescript
import { Router } from 'express';
import { create, getAll, getById, update, remove } from './eventController';
import { protect, adminOnly } from '../../middleware/auth';
import { cacheMiddleware } from '../../middleware/cache';

export const eventRoutes = Router();
eventRoutes.post('/', protect, adminOnly, create);
eventRoutes.get('/', cacheMiddleware(300), getAll);
eventRoutes.get('/:id', cacheMiddleware(1800), getById);
eventRoutes.put('/:id', protect, update);
eventRoutes.delete('/:id', protect, remove);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eventService.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/events/ src/middleware/cache.ts tests/unit/eventService.test.ts
git commit -m "feat(events): implement event management, querying, caching, and admin authorization"
```

---

### Task 6: Booking Engine & Transactional Concurrency Control

**Files:**
- Create: `src/modules/bookings/bookingValidator.ts`
- Create: `src/modules/bookings/bookingService.ts`
- Create: `src/modules/bookings/bookingController.ts`
- Create: `src/modules/bookings/bookingRoutes.ts`
- Test: `tests/unit/bookingService.test.ts`

**Interfaces:**
- Consumes: `src/db`, `src/db/schema/tickets`, `src/db/schema/events`, `src/config/redis`
- Produces: `createBooking`, `confirmBooking`, `cancelBooking`, `getUserBookings`, `getBookingById`, `bookingRoutes`.

- [ ] **Step 1: Write unit tests for booking hold expiration and concurrency checks**

```typescript
// tests/unit/bookingService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmBooking } from '../../src/modules/bookings/bookingService';
import { ConflictError } from '../../src/utils/errors';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../src/config/redis', () => ({
  redisClient: {
    invalidateEvent: vi.fn().mockResolvedValue(true),
    del: vi.fn().mockResolvedValue(true),
  },
}));

describe('Booking Service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should throw ConflictError if booking hold has expired', async () => {
    const expiredTicket = {
      id: 'ticket-1',
      userId: 'user-1',
      status: 'pending',
      holdExpiry: new Date(Date.now() - 10000), // in the past
    };

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([expiredTicket]),
      }),
    });

    await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow(ConflictError);
    await expect(confirmBooking('ticket-1', 'user-1')).rejects.toThrow('Booking hold has expired');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/bookingService.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement Booking service with transactions and row locking**

Write `src/modules/bookings/bookingValidator.ts`:
```typescript
import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z.string().uuid('Invalid event ID format'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(100, 'Cannot book more than 100 tickets at once'),
});
```

Write `src/modules/bookings/bookingService.ts`:
```typescript
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { events, tickets, users } from '../../db/schema';
import { NotFoundError, ConflictError, AuthorizationError } from '../../utils/errors';
import { redisClient } from '../../config/redis';
import { env } from '../../config/env';

export const createBooking = async (eventId: string, userId: string, quantity: number) => {
  return await db.transaction(async (tx) => {
    // 1. Lock event row to guarantee atomicity under concurrent requests
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update');

    if (!event) throw new NotFoundError('Event not found');
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
    const holdExpiry = new Date(Date.now() + env.HOLD_DURATION_MS);
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
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw new NotFoundError('Booking not found');

  if (ticket.userId !== userId) {
    throw new AuthorizationError('Not authorized to confirm this booking');
  }

  if (ticket.status !== 'pending') {
    throw new ConflictError(`Booking cannot be confirmed. Current status: ${ticket.status}`);
  }

  if (ticket.holdExpiry && new Date() > new Date(ticket.holdExpiry)) {
    throw new ConflictError('Booking hold has expired');
  }

  const [confirmed] = await db
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
};

export const cancelBooking = async (ticketId: string, userId: string) => {
  return await db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
    if (!ticket) throw new NotFoundError('Booking not found');

    if (ticket.userId !== userId) {
      throw new AuthorizationError('Not authorized to cancel this booking');
    }

    if (ticket.status === 'cancelled') {
      throw new ConflictError('Booking already cancelled');
    }

    const [event] = await tx.select().from(events).where(eq(events.id, ticket.eventId)).for('update');
    if (!event) throw new NotFoundError('Associated event not found');

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

    // Fix: invalidate both event and availability cache
    await redisClient.invalidateEvent(ticket.eventId);

    return cancelled;
  });
};

export const getUserBookings = async (userId: string) => {
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

  if (!booking) throw new NotFoundError('Booking not found');
  if (booking.userId !== userId) {
    throw new AuthorizationError('Not authorized to view this booking');
  }

  return booking;
};
```

Write `src/modules/bookings/bookingController.ts`:
```typescript
import { Request, Response } from 'express';
import { createBooking, confirmBooking, cancelBooking, getUserBookings, getBookingById } from './bookingService';
import { createBookingSchema } from './bookingValidator';
import { asyncHandler } from '../../middleware/error';
import { sendSuccess } from '../../utils/response';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const validated = createBookingSchema.parse(req.body);
  const booking = await createBooking(validated.eventId, req.user!.id, validated.quantity);
  return sendSuccess(res, 201, booking, 'Booking created successfully');
});

export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const booking = await confirmBooking(req.params.id, req.user!.id);
  return sendSuccess(res, 200, booking, 'Booking confirmed successfully');
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const booking = await cancelBooking(req.params.id, req.user!.id);
  return sendSuccess(res, 200, booking, 'Booking cancelled successfully');
});

export const getUserBookingsList = asyncHandler(async (req: Request, res: Response) => {
  const bookings = await getUserBookings(req.user!.id);
  return sendSuccess(res, 200, bookings);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const booking = await getBookingById(req.params.id, req.user!.id);
  return sendSuccess(res, 200, booking);
});
```

Write `src/modules/bookings/bookingRoutes.ts`:
```typescript
import { Router } from 'express';
import { create, confirm, cancel, getUserBookingsList, getById } from './bookingController';
import { protect } from '../../middleware/auth';

export const bookingRoutes = Router();
bookingRoutes.post('/', protect, create);
bookingRoutes.post('/:id/confirm', protect, confirm);
bookingRoutes.post('/:id/cancel', protect, cancel);
bookingRoutes.get('/', protect, getUserBookingsList);
bookingRoutes.get('/:id', protect, getById);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/bookingService.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/bookings/ tests/unit/bookingService.test.ts
git commit -m "feat(bookings): implement transactional ticket holds, confirmation, and cancellation with inventory locking"
```

---

### Task 7: Background Hold Cleanup, Express App Bootstrap & Cleanup Legacy JS

**Files:**
- Create: `src/services/holdCleanupService.ts`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Delete: legacy `.js` files in `src/`, `server.js`, legacy `tests/`
- Test: `tests/integration/api.test.ts`

**Interfaces:**
- Consumes: All modules, `src/db`, `src/config/redis`, `src/config/env`
- Produces: `app` Express application, `server` HTTP server, `holdCleanupService`.

- [ ] **Step 1: Write integration test for Express App and healthcheck**

```typescript
// tests/integration/api.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';

describe('API Smoke & Healthcheck', () => {
  it('GET / should return running message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('TIX-HUB API is running');
  });

  it('GET /health should return system status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.services).toHaveProperty('api');
  });

  it('GET /api/v1/invalid-route should return 404', async () => {
    const res = await request(app).get('/api/v1/invalid-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api.test.ts`  
Expected: FAIL (cannot find module `../../src/app`)

- [ ] **Step 3: Implement background cleanup service, app.ts, and server.ts**

Write `src/services/holdCleanupService.ts`:
```typescript
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { events, tickets } from '../db/schema';
import { redisClient } from '../config/redis';

export class HoldCleanupService {
  private timer: NodeJS.Timeout | null = null;
  public isRunning = false;

  start(intervalMs = 5 * 60 * 1000) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.cleanupExpiredHolds().catch(console.error);
    }, intervalMs);
    this.cleanupExpiredHolds().catch(console.error);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  async cleanupExpiredHolds(): Promise<number> {
    const now = new Date();
    return await db.transaction(async (tx) => {
      // Use SKIP LOCKED for safe concurrent multi-worker execution
      const expiredTickets = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.status, 'pending'), lt(tickets.holdExpiry, now)))
        .for('update', { skipLocked: true });

      if (expiredTickets.length === 0) return 0;

      for (const ticket of expiredTickets) {
        // Return tickets to event stock
        const [event] = await tx.select().from(events).where(eq(events.id, ticket.eventId)).for('update');
        if (event) {
          await tx
            .update(events)
            .set({
              availableTickets: event.availableTickets + ticket.quantity,
              updatedAt: new Date(),
            })
            .where(eq(events.id, event.id));
        }

        // Update status to 'expired' (valid in ticketStatusEnum)
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
```

Write `src/app.ts`:
```typescript
import express from 'express';
import { userRoutes } from './modules/users/userRoutes';
import { eventRoutes } from './modules/events/eventRoutes';
import { bookingRoutes } from './modules/bookings/bookingRoutes';
import { errorHandler } from './middleware/error';
import { redisClient } from './config/redis';
import { holdCleanupService } from './services/holdCleanupService';

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'TIX-HUB API is running',
    cache: redisClient.isConnected ? 'Connected' : 'Disconnected',
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      database: 'connected',
      cache: redisClient.isConnected ? 'connected' : 'disconnected',
      cleanupService: holdCleanupService.isRunning ? 'active' : 'stopped',
    },
  });
});

app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/bookings', bookingRoutes);

app.use((req, res, next) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

app.use(errorHandler);
```

Write `src/server.ts`:
```typescript
import { app } from './app';
import { env } from './config/env';
import { redisClient } from './config/redis';
import { holdCleanupService } from './services/holdCleanupService';
import { pool } from './db';

const startServer = async () => {
  await redisClient.connect();
  holdCleanupService.start();

  const server = app.listen(env.PORT, () => {
    console.log(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Initiating graceful shutdown...`);
    holdCleanupService.stop();
    server.close(async () => {
      await redisClient.disconnect();
      await pool.end();
      console.log('Server and connections cleanly shut down.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(console.error);
}
```

Delete legacy MongoDB files and directories:
- `server.js`
- `src/config/db.js`
- `src/models/`
- legacy controllers, routes, validators, tests (replaced by new TypeScript modules and Vitest suite).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/api.test.ts`  
Expected: PASS

- [ ] **Step 5: Run full test suite and build verification**

Run: `npm test && npm run build`  
Expected: All tests PASS and build creates bundle in `dist/` without type errors.

- [ ] **Step 6: Commit changes**

```bash
git add src/ tests/
git rm -rf server.js src/models/
git commit -m "feat: complete TypeScript migration with PostgreSQL, Drizzle ORM, and cleanup legacy Mongo code"
```
