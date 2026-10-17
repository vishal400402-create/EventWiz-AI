import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import crypto from 'node:crypto';
export type AuthedRequest = Request & { userId?: string };
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const sid = req.cookies?.ew_session;
  const session = sid && (await db.query<{user_id:string}>('SELECT user_id FROM sessions WHERE id=$1 AND expires_at>$2', [sid, new Date().toISOString()])).rows[0];
  if (!session) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
  req.userId = session.user_id; next();
}
export async function csrf(req: Request, res: Response, next: NextFunction) {
  if (['GET','HEAD','OPTIONS'].includes(req.method) || req.path.startsWith('/api/auth/') || req.path.startsWith('/api/public/') || req.path === '/api/webhooks/whatsapp') return next();
  const sid = req.cookies?.ew_session;
  const token = req.get('x-csrf-token');
  if (!sid || !token) return res.status(403).json({error:{code:'CSRF',message:'Invalid CSRF token.'}});
  const session = (await db.query<{csrf_token_hash:string}>('SELECT csrf_token_hash FROM sessions WHERE id=$1 AND expires_at>$2', [sid, new Date().toISOString()])).rows[0];
  const suppliedHash = crypto.createHash('sha256').update(token).digest('hex');
  if (!session || !crypto.timingSafeEqual(Buffer.from(session.csrf_token_hash), Buffer.from(suppliedHash))) return res.status(403).json({error:{code:'CSRF',message:'Invalid CSRF token.'}});
  next();
}
