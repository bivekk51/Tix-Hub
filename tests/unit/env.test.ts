import { describe, it, expect } from 'vitest';
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
