import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
export type AuthedRequest = Request & { userId?: string };
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const sid = req.cookies?.ew_session;
  const session = sid && db.prepare('SELECT user_id FROM sessions WHERE id=? AND expires_at>?').get(sid, new Date().toISOString()) as {user_id:string}|undefined;
  if (!session) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
  req.userId = session.user_id; next();
}
export function csrf(req: Request, res: Response, next: NextFunction) {
  if (['GET','HEAD','OPTIONS'].includes(req.method) || req.path === '/api/auth/login' || req.path === '/api/webhooks/whatsapp') return next();
  if (!req.cookies?.ew_csrf || req.get('x-csrf-token') !== req.cookies.ew_csrf) return res.status(403).json({error:{code:'CSRF',message:'Invalid CSRF token.'}});
  next();
}
