import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const app = new Hono<AppEnv>();

app.get('/me', requireAuth, c => c.json(c.get('user')));

export default app;
