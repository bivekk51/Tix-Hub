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

let parsedEnv: z.infer<typeof envSchema>;
try {
  parsedEnv = validateEnv(process.env);
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    parsedEnv = {} as z.infer<typeof envSchema>;
  } else {
    throw error;
  }
}

export const env = parsedEnv;
