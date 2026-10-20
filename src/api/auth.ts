import type { FastifyRequest, FastifyReply } from 'fastify';
import { loadEnv } from '../config/env.js';

export async function verifyServiceToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const env = loadEnv();
  const authHeader = request.headers['authorization'];
  const tokenHeader = request.headers['x-service-token'];

  let token: string | undefined;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (typeof tokenHeader === 'string') {
    token = tokenHeader.trim();
  }

  // If token is provided, validate it strictly
  if (token !== undefined) {
    if (token !== env.SERVICE_TOKEN) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: 'Invalid service token',
      });
    }
    return;
  }

  // In production, token is strictly required
  if (env.NODE_ENV === 'production') {
    return reply.code(401).send({
      code: 'UNAUTHORIZED',
      message: 'Service token required',
    });
  }
}

export async function verifyAdminToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const env = loadEnv();
  const authHeader = request.headers['authorization'];
  const tokenHeader = request.headers['x-admin-token'];

  let token: string | undefined;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (typeof tokenHeader === 'string') {
    token = tokenHeader.trim();
  }

  // If token is provided, validate it strictly
  if (token !== undefined) {
    if (token !== env.ADMIN_TOKEN) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: 'Invalid admin token',
      });
    }
    return;
  }

  // In production, admin token is strictly required
  if (env.NODE_ENV === 'production') {
    return reply.code(401).send({
      code: 'UNAUTHORIZED',
      message: 'Admin token required',
    });
  }
}
