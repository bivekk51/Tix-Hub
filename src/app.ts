import express from 'express';
import { redisClient } from './config/redis.js';
import { pool } from './db/index.js';
import { userRoutes } from './modules/users/userRoutes.js';
import { eventRoutes } from './modules/events/eventRoutes.js';
import { bookingRoutes } from './modules/bookings/bookingRoutes.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'TIX-HUB API is running',
    cache: redisClient.isConnected ? 'Connected' : 'Disconnected',
  });
});

// Health check endpoint
app.get('/health', async (_req, res) => {
  let dbStatus = 'connected';
  try {
    await pool.query('SELECT 1');
  } catch (_err) {
    dbStatus = 'disconnected';
  }

  const isHealthy = dbStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      database: dbStatus,
      cache: redisClient.isConnected ? 'connected' : 'disconnected',
    },
  });
});

// API Routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/bookings', bookingRoutes);

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export { app };
export default app;
