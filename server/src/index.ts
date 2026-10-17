import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from './config.js';
import { audit, db, id, now } from './db.js';
import { csrf, requireAuth, type AuthedRequest } from './auth.js';
import { generateCopy, sendTemplate, validSignature, verifyWhatsApp } from './services.js';

type Row = Record<string, any>;
const app = express();
const asyncRoute = (handler: (req: any, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };
const error = (res: Response, code: string, message: string, status = 400) => res.status(status).json({ error: { code, message } });
const isUniqueViolation = (value: unknown) => typeof value === 'object' && value !== null && 'code' in value && (value as { code?: string }).code === '23505';
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } } });
const passwordSchema = z.string().min(12).max(128).regex(/[a-z]/, 'Password needs a lowercase letter.').regex(/[A-Z]/, 'Password needs an uppercase letter.').regex(/\d/, 'Password needs a number.').regex(/[^A-Za-z0-9]/, 'Password needs a symbol.');
const eventSchema = z.object({ name:z.string().min(2).max(120), type:z.enum(['Wedding','Birthday','College','Seminar','Conference','Corporate','Other']), description:z.string().max(3000).default(''), venue:z.string().max(250).default(''), map_url:z.string().url().or(z.literal('')).default(''), start_at:z.string().datetime(), end_at:z.string().datetime(), timezone:z.string().min(1), registration_url:z.string().url().or(z.literal('')).default(''), dress_code:z.string().max(200).default(''), parking:z.string().max(500).default(''), organizer_contact:z.string().max(250).default('') }).refine(x => new Date(x.end_at) > new Date(x.start_at), { message: 'End time must be after start time.' });
const guestSchema = z.object({ event_id:z.string().uuid(), name:z.string().min(1).max(120), phone:z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format, e.g. +919876543210'), email:z.string().email().or(z.literal('')).default(''), rsvp:z.enum(['Pending','Attending','Not Attending','Maybe']).default('Pending'), consent:z.boolean().default(false), consent_source:z.string().max(200).default('') }).refine(x => !x.consent || x.consent_source.trim().length > 1, { message: 'A recorded consent source is required.' });
const serviceSchema = z.object({ name:z.string().trim().min(2).max(120), category:z.string().trim().min(2).max(80), price:z.number().min(0).max(100000000), pricingType:z.enum(['fixed','starting','quote']), description:z.string().trim().min(2).max(3000), inclusions:z.array(z.string().trim().min(1).max(200)).max(30).default([]), addOns:z.array(z.string().trim().min(1).max(200)).max(30).default([]), availability:z.enum(['Available','Limited','Unavailable']).default('Available'), location:z.string().max(250).default(''), published:z.boolean().default(false) });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.use('/api/webhooks/whatsapp', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '250kb' }));
app.use(cookieParser());
app.use(csrf);

const sessionOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.mode === 'live' || process.env.NODE_ENV === 'production', maxAge: 7 * 864e5, path: '/' };
async function establishSession(res: Response, user: { id: string; name: string; email: string }) {
  const sessionId = id();
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const csrfHash = crypto.createHash('sha256').update(csrfToken).digest('hex');
  const created = now();
  await db.query('INSERT INTO sessions (id,user_id,csrf_token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)', [sessionId, user.id, csrfHash, new Date(Date.now() + 7 * 864e5).toISOString(), created]);
  res.cookie('ew_session', sessionId, sessionOptions);
  res.json({ user: { id: user.id, name: user.name, email: user.email }, csrfToken });
}
async function getService(serviceId: string, userId?: string) {
  const values = userId ? [serviceId, userId] : [serviceId];
  const condition = userId ? 'id=$1 AND user_id=$2' : 'id=$1';
  const service = (await db.query<Row>(`SELECT * FROM services WHERE ${condition}`, values)).rows[0];
  if (!service) return null;
  return { ...service, price: service.price_paise / 100, pricingType: service.pricing_type, inclusions: service.inclusions || [], addOns: service.add_ons || [], published: Boolean(service.published), images: [] };
}

app.get('/health', (_req, res) => res.json({ ok: true, mode: config.mode, time: now() }));
app.get('/api/mode', (_req, res) => res.json({ mode: config.mode, aiConfigured: Boolean(config.openAiKey), simulated: config.mode === 'demo' }));

app.post('/api/auth/signup', authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ name:z.string().trim().min(2).max(120), email:z.string().trim().email().max(254), password:passwordSchema }).safeParse(req.body);
  if (!parsed.success) return error(res, 'VALIDATION', parsed.error.issues[0].message);
  const email = parsed.data.email.toLowerCase();
  try {
    const user = { id:id(), name:parsed.data.name, email };
    await db.query('INSERT INTO users (id,email,password_hash,name,created_at) VALUES ($1,$2,$3,$4,$5)', [user.id, user.email, await bcrypt.hash(parsed.data.password, 12), user.name, now()]);
    await establishSession(res, user);
  } catch (cause) { if (isUniqueViolation(cause)) return error(res, 'EMAIL_EXISTS', 'An account with that email already exists.', 409); throw cause; }
}));
app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ email:z.string().trim().email(), password:z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return error(res, 'VALIDATION', 'Email and password are required.');
  const user = (await db.query<{id:string;password_hash:string;name:string;email:string}>('SELECT id,password_hash,name,email FROM users WHERE email=$1', [parsed.data.email.toLowerCase()])).rows[0];
  if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) return error(res, 'INVALID_LOGIN', 'Invalid email or password.', 401);
  await db.query('DELETE FROM sessions WHERE user_id=$1 OR expires_at <= $2', [user.id, now()]);
  await establishSession(res, user);
}));
app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => { await db.query('DELETE FROM sessions WHERE id=$1', [req.cookies.ew_session]); res.clearCookie('ew_session', { path: '/' }); res.json({ ok:true }); }));
app.get('/api/auth/me', requireAuth, asyncRoute(async (req: AuthedRequest, res) => { const user = (await db.query('SELECT id,name,email FROM users WHERE id=$1', [req.userId])).rows[0]; res.json({ user }); }));

app.get('/api/events', requireAuth, asyncRoute(async (req: AuthedRequest, res) => res.json({ items:(await db.query('SELECT * FROM events WHERE user_id=$1 ORDER BY start_at ASC', [req.userId])).rows })));
app.post('/api/events', requireAuth, asyncRoute(async (req: AuthedRequest, res) => { const parsed=eventSchema.safeParse(req.body); if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message); const eventId=id(); const p=parsed.data; await db.query('INSERT INTO events (id,user_id,name,type,description,venue,map_url,start_at,end_at,timezone,registration_url,dress_code,parking,organizer_contact,archived,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [eventId,req.userId,p.name,p.type,p.description,p.venue,p.map_url,p.start_at,p.end_at,p.timezone,p.registration_url,p.dress_code,p.parking,p.organizer_contact,false,now()]); await audit(req.userId!,'event.created',eventId); res.status(201).json({id:eventId,...p}); }));
app.patch('/api/events/:id', requireAuth, asyncRoute(async (req: AuthedRequest, res) => { const old=(await db.query<Row>('SELECT * FROM events WHERE id=$1 AND user_id=$2',[req.params.id,req.userId])).rows[0]; if(!old)return error(res,'NOT_FOUND','Event not found.',404); const parsed=eventSchema.safeParse({...old,...req.body}); if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message); const p=parsed.data; await db.query('UPDATE events SET name=$1,type=$2,description=$3,venue=$4,map_url=$5,start_at=$6,end_at=$7,timezone=$8,registration_url=$9,dress_code=$10,parking=$11,organizer_contact=$12 WHERE id=$13 AND user_id=$14',[p.name,p.type,p.description,p.venue,p.map_url,p.start_at,p.end_at,p.timezone,p.registration_url,p.dress_code,p.parking,p.organizer_contact,req.params.id,req.userId]); await audit(req.userId!,'event.updated',String(req.params.id)); res.json({id:req.params.id,...p}); }));
app.post('/api/events/:id/archive', requireAuth, asyncRoute(async (req: AuthedRequest,res) => { const result=await db.query('UPDATE events SET archived=TRUE WHERE id=$1 AND user_id=$2',[req.params.id,req.userId]); if(!result.rowCount)return error(res,'NOT_FOUND','Event not found.',404); await audit(req.userId!,'event.archived',String(req.params.id));res.json({ok:true}); }));

app.get('/api/guests', requireAuth, asyncRoute(async (req: AuthedRequest,res) => { const eventId=String(req.query.eventId||''); const search=String(req.query.q||''); const page=Math.max(1,Number(req.query.page||1)); const values:unknown[]=[req.userId]; let filter='user_id=$1'; if(eventId){values.push(eventId);filter+=` AND event_id=$${values.length}`;} if(search){values.push(`%${search}%`);filter+=` AND (name ILIKE $${values.length} OR phone ILIKE $${values.length})`;} const total=Number((await db.query<{count:string}>('SELECT count(*) AS count FROM guests WHERE '+filter,values)).rows[0].count); values.push((page-1)*25); const items=(await db.query(`SELECT * FROM guests WHERE ${filter} ORDER BY created_at DESC LIMIT 25 OFFSET $${values.length}`,values)).rows;res.json({items,page,total}); }));
app.post('/api/guests', requireAuth, asyncRoute(async (req: AuthedRequest,res) => { const parsed=guestSchema.safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message);const p=parsed.data;if(!(await db.query('SELECT id FROM events WHERE id=$1 AND user_id=$2',[p.event_id,req.userId])).rowCount)return error(res,'NOT_FOUND','Event not found.',404);const guestId=id(), recorded=now();try { await db.transaction(async client=>{await client.query('INSERT INTO guests (id,user_id,event_id,name,phone,email,rsvp,consent,consent_source,consent_at,suppressed,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[guestId,req.userId,p.event_id,p.name,p.phone,p.email,p.rsvp,p.consent,p.consent_source,p.consent?recorded:null,false,recorded]);if(p.consent)await client.query('INSERT INTO consent_records (id,user_id,guest_id,status,source,purpose,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id(),req.userId,guestId,'granted',p.consent_source,'event messaging',recorded]);});await audit(req.userId!,'guest.created',guestId);res.status(201).json({id:guestId,...p}); }catch(cause){if(isUniqueViolation(cause))return error(res,'DUPLICATE','That phone number is already on this event guest list.',409);throw cause;} }));
app.patch('/api/guests/:id', requireAuth, asyncRoute(async (req: AuthedRequest,res) => { const old=(await db.query<Row>('SELECT * FROM guests WHERE id=$1 AND user_id=$2',[req.params.id,req.userId])).rows[0];if(!old)return error(res,'NOT_FOUND','Guest not found.',404);const parsed=guestSchema.safeParse({...old,...req.body,event_id:old.event_id});if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message);const p=parsed.data,recorded=now(),changed=Boolean(old.consent)!==p.consent;await db.transaction(async client=>{await client.query('UPDATE guests SET name=$1,phone=$2,email=$3,rsvp=$4,consent=$5,consent_source=$6,consent_at=$7 WHERE id=$8 AND user_id=$9',[p.name,p.phone,p.email,p.rsvp,p.consent,p.consent_source,p.consent?(old.consent_at||recorded):null,req.params.id,req.userId]);if(changed)await client.query('INSERT INTO consent_records (id,user_id,guest_id,status,source,purpose,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id(),req.userId,req.params.id,p.consent?'granted':'revoked',p.consent?p.consent_source:'Organizer update','event messaging',recorded]);});res.json({ok:true}); }));
app.delete('/api/guests/:id', requireAuth, asyncRoute(async (req: AuthedRequest,res)=>{const result=await db.query('DELETE FROM guests WHERE id=$1 AND user_id=$2',[req.params.id,req.userId]);if(!result.rowCount)return error(res,'NOT_FOUND','Guest not found.',404);res.status(204).end();}));
app.post('/api/guests/import',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({event_id:z.string().uuid(),rows:z.array(guestSchema.omit({event_id:true})).max(500)}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Invalid CSV rows.');if(!(await db.query('SELECT id FROM events WHERE id=$1 AND user_id=$2',[parsed.data.event_id,req.userId])).rowCount)return error(res,'NOT_FOUND','Event not found.',404);let added=0,skipped=0;for(const row of parsed.data.rows){try{await db.query('INSERT INTO guests (id,user_id,event_id,name,phone,email,rsvp,consent,consent_source,consent_at,suppressed,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id(),req.userId,parsed.data.event_id,row.name,row.phone,row.email,row.rsvp,row.consent,row.consent_source,row.consent?now():null,false,now()]);added++;}catch(cause){if(isUniqueViolation(cause)){skipped++;continue;}throw cause;}}res.json({added,skipped});}));

app.get('/api/templates',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>res.json({items:(await db.query('SELECT * FROM templates WHERE user_id=$1',[req.userId])).rows})));
app.post('/api/templates',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({name:z.string().min(2).max(128),category:z.string().min(2).max(80),body:z.string().min(2).max(4096),approved:z.boolean().default(false)}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Invalid template.');const p=parsed.data,templateId=id();await db.query('INSERT INTO templates (id,user_id,name,category,body,approved) VALUES ($1,$2,$3,$4,$5,$6)',[templateId,req.userId,p.name,p.category,p.body,p.approved]);res.status(201).json({id:templateId,...p});}));
app.get('/api/campaigns',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>res.json({items:(await db.query('SELECT c.*,e.name AS event_name FROM campaigns c JOIN events e ON e.id=c.event_id WHERE c.user_id=$1 ORDER BY c.created_at DESC',[req.userId])).rows})));
app.post('/api/campaigns',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({event_id:z.string().uuid(),name:z.string().min(2).max(160),template_id:z.string().uuid().nullable().optional(),scheduled_at:z.string().datetime().nullable().optional()}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Invalid campaign.');const p=parsed.data;if(!(await db.query('SELECT id FROM events WHERE id=$1 AND user_id=$2',[p.event_id,req.userId])).rowCount)return error(res,'NOT_FOUND','Event not found.',404);const campaignId=id();await db.query('INSERT INTO campaigns (id,user_id,event_id,name,template_id,status,scheduled_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[campaignId,req.userId,p.event_id,p.name,p.template_id||null,'Draft',p.scheduled_at||null,now()]);res.status(201).json({id:campaignId,status:'Draft',...p});}));
app.get('/api/campaigns/:id/preview',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const campaign=(await db.query<{event_id:string}>('SELECT event_id FROM campaigns WHERE id=$1 AND user_id=$2',[req.params.id,req.userId])).rows[0];if(!campaign)return error(res,'NOT_FOUND','Campaign not found.',404);const guests=(await db.query<{consent:boolean;suppressed:boolean;phone:string}>('SELECT consent,suppressed,phone FROM guests WHERE event_id=$1 AND user_id=$2',[campaign.event_id,req.userId])).rows;const blocked=new Set((await db.query<{phone:string}>('SELECT phone FROM suppressions WHERE user_id=$1',[req.userId])).rows.map(x=>x.phone));let eligible=0,skipped=0;guests.forEach(g=>g.consent&&!g.suppressed&&!blocked.has(g.phone)?eligible++:skipped++);res.json({eligible,skipped,invalid:0,simulated:config.mode==='demo'});}));
app.post('/api/campaigns/:id/confirm',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const campaign=(await db.query<{id:string;event_id:string;template_id:string|null;status:string}>('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2',[req.params.id,req.userId])).rows[0];if(!campaign)return error(res,'NOT_FOUND','Campaign not found.',404);if(campaign.status!=='Draft')return error(res,'INVALID_STATE','Only draft campaigns can be confirmed.');const template=campaign.template_id?(await db.query<{name:string;approved:boolean}>('SELECT name,approved FROM templates WHERE id=$1 AND user_id=$2',[campaign.template_id,req.userId])).rows[0]:undefined;if(config.mode==='live'&&(!template||!template.approved))return error(res,'TEMPLATE_REQUIRED','Live campaigns require an approved template.');const guests=(await db.query<{id:string;phone:string;name:string}>('SELECT id,phone,name FROM guests WHERE event_id=$1 AND user_id=$2 AND consent=TRUE AND suppressed=FALSE',[campaign.event_id,req.userId])).rows;const blocked=new Set((await db.query<{phone:string}>('SELECT phone FROM suppressions WHERE user_id=$1',[req.userId])).rows.map(x=>x.phone));let sent=0,failed=0;for(const guest of guests.filter(x=>!blocked.has(x.phone)).slice(0,100)){try{const result=await sendTemplate({to:guest.phone,name:template?.name||'demo_event_update',parameters:[guest.name]});await db.query('INSERT INTO messages (id,user_id,event_id,guest_id,campaign_id,direction,content,provider_id,status,simulated,error,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id(),req.userId,campaign.event_id,guest.id,campaign.id,'outbound',template?.name||'Demo event update',result.providerId,result.status,result.simulated,null,now()]);sent++;}catch(cause){await db.query('INSERT INTO messages (id,user_id,event_id,guest_id,campaign_id,direction,content,provider_id,status,simulated,error,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id(),req.userId,campaign.event_id,guest.id,campaign.id,'outbound',template?.name||'',null,'failed',false,String(cause).slice(0,300),now()]);failed++;}}await db.query('UPDATE campaigns SET status=$1 WHERE id=$2 AND user_id=$3',['Sent',campaign.id,req.userId]);await audit(req.userId!,'campaign.confirmed',campaign.id);res.json({sent,failed,simulated:config.mode==='demo'});}));

app.post('/api/ai/generate',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({event_id:z.string().uuid(),recipient:z.string().max(120).optional(),purpose:z.enum(['Invitation','Registration confirmation','Reminder','Update','Thank you','FAQ']),language:z.enum(['English','Hindi','Hinglish']),tone:z.enum(['Friendly','Professional','Formal','Festive']),length:z.enum(['Short','Medium','Long']),instructions:z.string().max(600).optional()}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Invalid AI request.');const event=(await db.query<Row>('SELECT * FROM events WHERE id=$1 AND user_id=$2',[parsed.data.event_id,req.userId])).rows[0];if(!event)return error(res,'NOT_FOUND','Event not found.',404);try{res.json(await generateCopy({event,...parsed.data}));}catch(cause){error(res,'AI_ERROR',cause instanceof Error?cause.message:'AI generation failed.',502);}}));
app.get('/api/messages',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>res.json({items:(await db.query('SELECT m.*,g.name AS guest_name FROM messages m LEFT JOIN guests g ON g.id=m.guest_id WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 100',[req.userId])).rows})));
app.get('/api/suppressions',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>res.json({items:(await db.query('SELECT * FROM suppressions WHERE user_id=$1 ORDER BY created_at DESC',[req.userId])).rows})));
app.post('/api/suppressions',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({phone:z.string().regex(/^\+[1-9]\d{7,14}$/),reason:z.string().min(2).max(200)}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Use an E.164 phone number and a reason.');const p=parsed.data,recorded=now();await db.transaction(async client=>{await client.query('INSERT INTO suppressions (id,user_id,phone,reason,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,phone) DO NOTHING',[id(),req.userId,p.phone,p.reason,recorded]);const matching=(await client.query<{id:string}>('SELECT id FROM guests WHERE user_id=$1 AND phone=$2 AND consent=TRUE',[req.userId,p.phone])).rows;await client.query('UPDATE guests SET suppressed=TRUE,consent=FALSE WHERE user_id=$1 AND phone=$2',[req.userId,p.phone]);for(const guest of matching)await client.query('INSERT INTO consent_records (id,user_id,guest_id,status,source,purpose,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id(),req.userId,guest.id,'revoked',p.reason,'event messaging',recorded]);});await audit(req.userId!,'suppression.added',p.phone);res.status(201).json({ok:true});}));
app.get('/api/settings/whatsapp',requireAuth,asyncRoute(async(_req,res)=>{try{res.json(await verifyWhatsApp());}catch{res.json({connected:false,mode:config.mode,reason:'Could not reach Meta to verify this configuration.'});}}));
app.get('/api/jobs',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>res.json({items:(await db.query('SELECT * FROM scheduled_jobs WHERE user_id=$1 ORDER BY run_at',[req.userId])).rows})));
app.post('/api/jobs',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=z.object({campaign_id:z.string().uuid().nullable(),run_at:z.string().datetime(),type:z.enum(['24-hour reminder','2-hour reminder','Custom reminder','Registration confirmation','Event update'])}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Invalid schedule.');const p=parsed.data,jobId=id();await db.query('INSERT INTO scheduled_jobs (id,user_id,campaign_id,run_at,type,status,attempts) VALUES ($1,$2,$3,$4,$5,$6,$7)',[jobId,req.userId,p.campaign_id,p.run_at,p.type,'Scheduled',0]);res.status(201).json({id:jobId,...p,status:'Scheduled'});}));
app.post('/api/jobs/:id/:action',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const status=req.params.action==='cancel'?'Cancelled':req.params.action==='pause'?'Paused':null;if(!status)return error(res,'VALIDATION','Unsupported job action.');await db.query('UPDATE scheduled_jobs SET status=$1 WHERE id=$2 AND user_id=$3',[status,req.params.id,req.userId]);res.json({ok:true});}));

app.get('/api/webhooks/whatsapp',(req,res)=>{if(req.query['hub.verify_token']===config.whatsapp.verifyToken&&req.query['hub.mode']==='subscribe')return res.status(200).send(String(req.query['hub.challenge']||''));return res.sendStatus(403);});
app.post('/api/webhooks/whatsapp',asyncRoute(async(req,res)=>{const raw=req.body as Buffer;if(!validSignature(raw,req.get('x-hub-signature-256')))return res.sendStatus(401);try{const payload=JSON.parse(raw.toString());const providerEventId=payload.entry?.[0]?.id+':'+payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;await db.query('INSERT INTO webhook_events (id,provider_event_id,payload,received_at) VALUES ($1,$2,$3,$4) ON CONFLICT (provider_event_id) DO NOTHING',[id(),providerEventId||null,JSON.stringify(payload).slice(0,200000),now()]);}catch{return res.sendStatus(400);}res.sendStatus(200);}));

app.get('/api/services',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const rows=(await db.query<{id:string}>('SELECT id FROM services WHERE user_id=$1 ORDER BY created_at DESC',[req.userId])).rows;res.json({items:await Promise.all(rows.map(x=>getService(x.id,req.userId)))});}));
app.post('/api/services',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const parsed=serviceSchema.safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message);const p=parsed.data,serviceId=id(),timestamp=now();await db.query('INSERT INTO services (id,user_id,name,category,price_paise,pricing_type,description,inclusions,add_ons,availability,location,published,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14)',[serviceId,req.userId,p.name,p.category,Math.round(p.price*100),p.pricingType,p.description,JSON.stringify(p.inclusions),JSON.stringify(p.addOns),p.availability,p.location,p.published,timestamp,timestamp]);await audit(req.userId!,'service.created',serviceId);res.status(201).json({item:await getService(serviceId,req.userId)});}));
app.patch('/api/services/:id',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const existing=await getService(String(req.params.id),req.userId);if(!existing)return error(res,'NOT_FOUND','Service not found.',404);const parsed=serviceSchema.safeParse({...existing,...req.body});if(!parsed.success)return error(res,'VALIDATION',parsed.error.issues[0].message);const p=parsed.data;await db.query('UPDATE services SET name=$1,category=$2,price_paise=$3,pricing_type=$4,description=$5,inclusions=$6::jsonb,add_ons=$7::jsonb,availability=$8,location=$9,published=$10,updated_at=$11 WHERE id=$12 AND user_id=$13',[p.name,p.category,Math.round(p.price*100),p.pricingType,p.description,JSON.stringify(p.inclusions),JSON.stringify(p.addOns),p.availability,p.location,p.published,now(),req.params.id,req.userId]);await audit(req.userId!,'service.updated',String(req.params.id));res.json({item:await getService(String(req.params.id),req.userId)});}));
app.post('/api/services/:id/images',requireAuth,(_req,res)=>error(res,'UPLOADS_DISABLED','Image uploads are disabled for the first public launch.',503));
app.delete('/api/services/:id',requireAuth,asyncRoute(async(req:AuthedRequest,res)=>{const result=await db.query('DELETE FROM services WHERE id=$1 AND user_id=$2',[req.params.id,req.userId]);if(!result.rowCount)return error(res,'NOT_FOUND','Service not found.',404);await audit(req.userId!,'service.deleted',String(req.params.id));res.json({ok:true});}));
app.get('/api/public/services',asyncRoute(async(_req,res)=>{const rows=(await db.query<{id:string}>('SELECT id FROM services WHERE published=TRUE AND availability != $1 ORDER BY created_at DESC',['Unavailable'])).rows;const services=(await Promise.all(rows.map(x=>getService(x.id)))).filter((service): service is NonNullable<typeof service> => service !== null);res.json({items:services.map(service=>{const {user_id,...publicService}=service as Row;return publicService;})});}));
app.post('/api/public/bookings',asyncRoute(async(req,res)=>{const parsed=z.object({serviceId:z.string().min(1),customerName:z.string().trim().min(2).max(100),phone:z.string().trim().min(7).max(20),eventType:z.string().trim().min(2).max(100),preferredDate:z.string().min(1).max(30),location:z.string().trim().min(2).max(200),guestCount:z.number().int().min(1).max(100000),notes:z.string().max(1000).optional().default('')}).safeParse(req.body);if(!parsed.success)return error(res,'VALIDATION','Please enter valid booking details.');const service=(await db.query<{id:string;user_id:string}>('SELECT id,user_id FROM services WHERE id=$1 AND published=TRUE',[parsed.data.serviceId])).rows[0];if(!service)return error(res,'NOT_FOUND','This service is not available.',404);const created=now(),bookingId=id(),reference=`EW-${crypto.randomUUID().slice(0,8).toUpperCase()}`,p=parsed.data;await db.query('INSERT INTO booking_requests (id,reference,service_id,user_id,customer_name,phone,event_type,preferred_date,location,guest_count,notes,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[bookingId,reference,service.id,service.user_id,p.customerName,p.phone,p.eventType,p.preferredDate,p.location,p.guestCount,p.notes,'New',created,created]);res.status(201).json({message:'Booking request submitted successfully.',reference,status:'New'});}));

app.get('/api/bookings', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const result = await db.query(
    `SELECT
       b.id,
       b.reference,
       b.customer_name AS "customerName",
       b.phone,
       b.event_type AS "eventType",
       b.preferred_date AS "preferredDate",
       b.location,
       b.guest_count AS "guestCount",
       b.notes,
       b.status,
       b.created_at AS "createdAt",
       s.name AS "serviceName"
     FROM booking_requests b
     INNER JOIN services s ON s.id = b.service_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [req.userId]
  );

  res.json({ items: result.rows });
}));


app.patch('/api/bookings/:id/status', requireAuth, asyncRoute(async (req: AuthedRequest, res) => {
  const parsed = z.object({
    status: z.enum(['Confirmed', 'Rejected'])
  }).safeParse(req.body);

  if (!parsed.success) {
    return error(res, 'VALIDATION', 'Choose Confirmed or Rejected.');
  }

  const result = await db.query(
    `UPDATE booking_requests
     SET status = $1, updated_at = $2
     WHERE id = $3 AND user_id = $4
     RETURNING id, status`,
    [parsed.data.status, now(), req.params.id, req.userId]
  );

  if (!result.rowCount) {
    return error(res, 'NOT_FOUND', 'Booking not found.', 404);
  }

  await audit(req.userId!, 'booking.status_updated', String(req.params.id));
  res.json({
    message: 'Booking status updated.',
    booking: result.rows[0]
  });
}));

app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{console.error('Request error:',err instanceof Error?err.message:'unknown');error(res,'SERVER_ERROR','Unexpected server error.',500);});
if(process.env.NODE_ENV!=='test'){if(!config.databaseUrl)throw new Error('DATABASE_URL is required. Run the explicit database migration before starting EventWiz.');app.listen(config.port,()=>console.log(`EventWiz API listening on ${config.port} (${config.mode} mode)`));}
export default app;
