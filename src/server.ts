import { app } from './app.js';
import { env } from './config/env.js';
import { redisClient } from './config/redis.js';
import { holdCleanupService } from './services/holdCleanupService.js';
import { pool } from './db/index.js';

let server: ReturnType<typeof app.listen> | null = null;
let isShuttingDown = false;

export async function bootstrap() {
  await redisClient.connect();
  holdCleanupService.start();

  server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });

  return server;
}

export const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  holdCleanupService.stop();

  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');
      try {
        await redisClient.disconnect();
        console.log('Redis connection closed.');
      } catch (err) {
        console.error('Error disconnecting Redis:', err);
      }
      try {
        await pool.end();
        console.log('Database pool closed.');
      } catch (err) {
        console.error('Error closing database pool:', err);
      }
      process.exit(0);
    });
  } else {
    try {
      await redisClient.disconnect();
    } catch {
      // ignore
    }
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { server };
