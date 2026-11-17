import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import productsRouter from './routes/products.js';
import { createOrdersRouter } from './routes/orders.js';
import { createAuthRouter } from './routes/auth.js';
import assistantRouter from './routes/assistant.js';
import { prisma } from './lib/prisma.js';

// Default database probe for /api/health. Tests pass their own checkDatabase.
const pingDatabase = () => prisma.$queryRaw`SELECT 1`;

export function createApp({ checkDatabase = pingDatabase, db = prisma } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // On a hosting platform the API sits behind a proxy. TRUST_PROXY=1 lets Express (and the
  // assistant rate limiter) use the real client address instead of the proxy's address.
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(helmet());
  // FRONTEND_URL may list several origins separated by commas. In development any
  // http://localhost:<port> page is also allowed, so a changed dev port does not break the API.
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim());
  const isDev = process.env.NODE_ENV !== 'production';
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)
      || (isDev && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))),
    // Lets the browser send the sign-in cookie with API requests from an allowed origin.
    credentials: true
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use((request, response, next) => { request.id = crypto.randomUUID(); response.setHeader('X-Request-ID', request.id); next(); });
  app.use(morgan(':method :url :status :response-time ms'));

  // Health checks the database too, so a deployment check cannot pass while PostgreSQL is down (defect D3).
  app.get('/api/health', async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ status: 'ok', database: 'ok' });
    } catch {
      response.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });
  app.use('/api/products', productsRouter);
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/orders', createOrdersRouter(db));
  app.use('/api/assistant', assistantRouter);
  app.use((_request, response) => response.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'API route could not be found.' } }));
  app.use((error, request, response, _next) => {
    console.error(`[${request.id}]`, error);
    // Malformed JSON from express.json() (defect D4: was reported as INTERNAL_ERROR).
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', traceId: request.id } });
    }
    // Only errors we raised on purpose carry a status; their code and message are safe to show.
    // Anything else (for example Prisma P1017 when the database drops) stays a generic 500 (defect D4).
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    const known = status < 500;
    response.status(status).json({ error: { code: known ? (error.code || 'REQUEST_ERROR') : 'INTERNAL_ERROR', message: known ? error.message : 'The server could not complete the request.', traceId: request.id } });
  });
  return app;
}
