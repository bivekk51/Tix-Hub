import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('API Health and Routing Integration', () => {
  it('GET / should return running message and cache status', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('TIX-HUB API is running');
  });

  it('GET /health should return healthy status and service list', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services).toHaveProperty('api', 'running');
    expect(res.body.services).toHaveProperty('database', 'connected');
  });

  it('GET /api/v1/non-existent-route should return 404', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
