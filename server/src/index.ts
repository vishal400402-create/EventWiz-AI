import express from 'express';

import type { NextFunction, Request, Response } from 'express';

import helmet from 'helmet'; import cors from 'cors'; import cookieParser from 'cookie-parser'; import rateLimit from 'express-rate-limit'; import bcrypt from 'bcryptjs'; import { z } from 'zod'; import crypto from 'node:crypto';

import multer from 'multer'; import fs from 'node:fs'; import path from 'node:path';

import { config } from './config.js'; import { db, id, now, audit } from './db.js'; import { requireAuth, csrf, type AuthedRequest } from './auth.js'; import { generateCopy, sendTemplate, validSignature, verifyWhatsApp } from './services.js';



const app = express();


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again later.'
    }
  }
});


const uploadsDir=path.resolve('uploads'); fs.mkdirSync(uploadsDir,{recursive:true});

const imageTypes=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);

const upload=multer({storage:multer.diskStorage({destination:uploadsDir,filename:(_req,file,cb)=>cb(null,`${crypto.randomUUID()}.${imageTypes.get(file.mimetype) || 'invalid'}`)}),limits:{fileSize:5*1024*1024,files:8},fileFilter:(_req,file,cb)=>cb(null,imageTypes.has(file.mimetype)&&/\.(jpe?g|png|webp)$/i.test(file.originalname))});

const isRealImage=(file:string,mime:string)=>{const b=fs.readFileSync(file);return (mime==='image/jpeg'&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)||(mime==='image/png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(mime==='image/webp'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')};

app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}})); app.use(cors({ origin: config.webOrigin, credentials: true }));

app.use('/uploads',express.static(uploadsDir,{index:false,fallthrough:false,maxAge:'7d',setHeaders:res=>res.setHeader('X-Content-Type-Options','nosniff')}));

app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));

app.use('/api/webhooks/whatsapp', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '250kb' })); app.use(cookieParser()); app.use(csrf);

const error = (res: Response, code: string, message: string, status = 400) => res.status(status).json({ error: { code, message } });

const eventSchema = z.object({name:z.string().min(2).max(120),type:z.enum(['Wedding','Birthday','College','Seminar','Conference','Corporate','Other']),description:z.string().max(3000).default(''),venue:z.string().max(250).default(''),map_url:z.string().url().or(z.literal('')).default(''),start_at:z.string().datetime(),end_at:z.string().datetime(),timezone:z.string().min(1),registration_url:z.string().url().or(z.literal('')).default(''),dress_code:z.string().max(200).default(''),parking:z.string().max(500).default(''),organizer_contact:z.string().max(250).default('')}).refine(x=>new Date(x.end_at)>new Date(x.start_at),{message:'End time must be after start time.'});

const guestSchema = z.object({event_id:z.string().uuid(),name:z.string().min(1).max(120),phone:z.string().regex(/^\+[1-9]\d{7,14}$/,'Use E.164 format, e.g. +919876543210'),email:z.string().email().or(z.literal('')).default(''),rsvp:z.enum(['Pending','Attending','Not Attending','Maybe']).default('Pending'),consent:z.boolean().default(false),consent_source:z.string().max(200).default('')}).refine(x=>!x.consent || x.consent_source.trim().length>1,{message:'A recorded consent source is required.'});



app.get('/health', (_req,res)=>res.json({ ok:true, mode:config.mode, time:now() }));

app.get('/api/mode', (_req,res)=>res.json({mode:config.mode, aiConfigured:Boolean(config.openAiKey), simulated:config.mode==='demo'}));

app.post('/api/auth/login', loginLimiter, async (req,res)=>{ const parsed=z.object({email:z.string().email(),password:z.string().min(8)}).safeParse(req.body); if(!parsed.success)return error(res,'VALIDATION','Email and password are required.'); const user=db.prepare('SELECT * FROM users WHERE email=?').get(parsed.data.email) as {id:string;password_hash:string;name:string;email:string}|undefined; if(!user || !await bcrypt.compare(parsed.data.password,user.password_hash)) return error(res,'INVALID_LOGIN','Invalid email or password.',401); const session=id(), csrfToken=crypto.randomUUID(); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(session,user.id,new Date(Date.now()+7*864e5).toISOString()); const secure=config.mode==='live'; res.cookie('ew_session',session,{httpOnly:true,sameSite:'lax',secure,maxAge:7*864e5}); res.cookie('ew_csrf',csrfToken,{httpOnly:false,sameSite:'lax',secure,maxAge:7*864e5}); res.json({user:{id:user.id,name:user.name,email:user.email},csrfToken}); });

app.post('/api/auth/logout',requireAuth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE id=?').run(req.cookies.ew_session);res.clearCookie('ew_session');res.json({ok:true});});

app.get('/api/auth/me',requireAuth,(req:AuthedRequest,res)=>{const u=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.userId);res.json({user:u});});

app.get('/api/events',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT * FROM events WHERE user_id=? ORDER BY start_at ASC').all(req.userId)}));

app.post('/api/events',requireAuth,(req:AuthedRequest,res)=>{const p=eventSchema.safeParse(req.body);if(!p.success)return error(res,'VALIDATION',p.error.issues[0].message);const eid=id();db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eid,req.userId,...Object.values(p.data),0,now());audit(req.userId!,'event.created',eid);res.status(201).json({id:eid,...p.data});});

app.patch('/api/events/:id',requireAuth,(req:AuthedRequest,res)=>{const eventId=String(req.params.id);const old=db.prepare('SELECT * FROM events WHERE id=? AND user_id=?').get(eventId,req.userId) as Record<string,unknown>|undefined;if(!old)return error(res,'NOT_FOUND','Event not found.',404);const p=eventSchema.safeParse({...old,...req.body});if(!p.success)return error(res,'VALIDATION',p.error.issues[0].message);db.prepare('UPDATE events SET name=?,type=?,description=?,venue=?,map_url=?,start_at=?,end_at=?,timezone=?,registration_url=?,dress_code=?,parking=?,organizer_contact=? WHERE id=? AND user_id=?').run(...Object.values(p.data),eventId,req.userId);audit(req.userId!,'event.updated',eventId);res.json({id:eventId,...p.data});});

app.post('/api/events/:id/archive',requireAuth,(req:AuthedRequest,res)=>{const eventId=String(req.params.id);const r=db.prepare('UPDATE events SET archived=1 WHERE id=? AND user_id=?').run(eventId,req.userId);if(!r.changes)return error(res,'NOT_FOUND','Event not found.',404);audit(req.userId!,'event.archived',eventId);res.json({ok:true});});

app.get('/api/guests',requireAuth,(req:AuthedRequest,res)=>{const eventId=String(req.query.eventId||'');const q=String(req.query.q||'');const page=Math.max(1,Number(req.query.page||1));const base=' FROM guests WHERE user_id=?'+(eventId?' AND event_id=?':'')+(q?' AND (name LIKE ? OR phone LIKE ?)':'');const args=[req.userId,...(eventId?[eventId]:[]),...(q?[`%${q}%`,`%${q}%`]:[])];const total=(db.prepare('SELECT count(*) count'+base).get(...args) as {count:number}).count;const items=db.prepare('SELECT *'+base+' ORDER BY created_at DESC LIMIT 25 OFFSET ?').all(...args,(page-1)*25);res.json({items,page,total});});

app.post('/api/guests',requireAuth,(req:AuthedRequest,res)=>{const p=guestSchema.safeParse(req.body);if(!p.success)return error(res,'VALIDATION',p.error.issues[0].message);const own=db.prepare('SELECT id FROM events WHERE id=? AND user_id=?').get(p.data.event_id,req.userId);if(!own)return error(res,'NOT_FOUND','Event not found.',404);try{const gid=id();const recorded=now();db.prepare('INSERT INTO guests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(gid,req.userId,p.data.event_id,p.data.name,p.data.phone,p.data.email,p.data.rsvp,p.data.consent?1:0,p.data.consent_source,p.data.consent?recorded:null,0,recorded);if(p.data.consent)db.prepare('INSERT INTO consent_records VALUES (?,?,?,?,?,?,?)').run(id(),req.userId,gid,'granted',p.data.consent_source,'event messaging',recorded);audit(req.userId!,'guest.created',gid);res.status(201).json({id:gid,...p.data});}catch{return error(res,'DUPLICATE','That phone number is already on this event guest list.',409)}});

app.patch('/api/guests/:id',requireAuth,(req:AuthedRequest,res)=>{const old=db.prepare('SELECT * FROM guests WHERE id=? AND user_id=?').get(req.params.id,req.userId) as Record<string,unknown>|undefined;if(!old)return error(res,'NOT_FOUND','Guest not found.',404);const p=guestSchema.safeParse({...old,...req.body,event_id:old.event_id});if(!p.success)return error(res,'VALIDATION',p.error.issues[0].message);const changed=Boolean(old.consent)!==p.data.consent;const recorded=now();db.prepare('UPDATE guests SET name=?,phone=?,email=?,rsvp=?,consent=?,consent_source=?,consent_at=? WHERE id=? AND user_id=?').run(p.data.name,p.data.phone,p.data.email,p.data.rsvp,p.data.consent?1:0,p.data.consent_source,p.data.consent?(old.consent_at||recorded):null,req.params.id,req.userId);if(changed)db.prepare('INSERT INTO consent_records VALUES (?,?,?,?,?,?,?)').run(id(),req.userId,req.params.id,p.data.consent?'granted':'revoked',p.data.consent?p.data.consent_source:'Organizer update','event messaging',recorded);res.json({ok:true});});

app.delete('/api/guests/:id',requireAuth,(req:AuthedRequest,res)=>{const r=db.prepare('DELETE FROM guests WHERE id=? AND user_id=?').run(req.params.id,req.userId);if(!r.changes)return error(res,'NOT_FOUND','Guest not found.',404);res.status(204).end();});

app.post('/api/guests/import',requireAuth,(req:AuthedRequest,res)=>{const p=z.object({event_id:z.string().uuid(),rows:z.array(guestSchema.omit({event_id:true})).max(500)}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Invalid CSV rows.');let added=0, skipped=0;for(const row of p.data.rows){try{db.prepare('INSERT INTO guests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),req.userId,p.data.event_id,row.name,row.phone,row.email,row.rsvp,row.consent?1:0,row.consent_source,row.consent?now():null,0,now());added++;}catch{skipped++;}}res.json({added,skipped});});

app.get('/api/templates',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT * FROM templates WHERE user_id=?').all(req.userId)}));

app.post('/api/templates',requireAuth,(req:AuthedRequest,res)=>{const p=z.object({name:z.string().min(2).max(128),category:z.string().min(2).max(80),body:z.string().min(2).max(4096),approved:z.boolean().default(false)}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Invalid template.');const tid=id();db.prepare('INSERT INTO templates VALUES (?,?,?,?,?,?)').run(tid,req.userId,p.data.name,p.data.category,p.data.body,p.data.approved?1:0);res.status(201).json({id:tid,...p.data});});

app.get('/api/campaigns',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT c.*,e.name event_name FROM campaigns c JOIN events e ON e.id=c.event_id WHERE c.user_id=? ORDER BY c.created_at DESC').all(req.userId)}));

app.post('/api/campaigns',requireAuth,(req:AuthedRequest,res)=>{const p=z.object({event_id:z.string().uuid(),name:z.string().min(2).max(160),template_id:z.string().uuid().nullable().optional(),scheduled_at:z.string().datetime().nullable().optional()}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Invalid campaign.');const event=db.prepare('SELECT id FROM events WHERE id=? AND user_id=?').get(p.data.event_id,req.userId);if(!event)return error(res,'NOT_FOUND','Event not found.',404);const cid=id();db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?,?,?,?)').run(cid,req.userId,p.data.event_id,p.data.name,p.data.template_id||null,'Draft',p.data.scheduled_at||null,now());res.status(201).json({id:cid,status:'Draft',...p.data});});

app.get('/api/campaigns/:id/preview',requireAuth,(req:AuthedRequest,res)=>{const c=db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(req.params.id,req.userId) as {event_id:string}|undefined;if(!c)return error(res,'NOT_FOUND','Campaign not found.',404);const rows=db.prepare('SELECT consent,suppressed,phone FROM guests WHERE event_id=? AND user_id=?').all(c.event_id,req.userId) as {consent:number;suppressed:number;phone:string}[];const globallySuppressed=new Set((db.prepare('SELECT phone FROM suppressions WHERE user_id=?').all(req.userId) as {phone:string}[]).map(x=>x.phone));let eligible=0,skipped=0;rows.forEach(g=>g.consent&&!g.suppressed&&!globallySuppressed.has(g.phone)?eligible++:skipped++);res.json({eligible,skipped,invalid:0,simulated:config.mode==='demo'});});

app.post('/api/campaigns/:id/confirm',requireAuth,async (req:AuthedRequest,res)=>{const c=db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(req.params.id,req.userId) as {id:string;event_id:string;template_id:string|null;status:string}|undefined;if(!c)return error(res,'NOT_FOUND','Campaign not found.',404);if(c.status!=='Draft')return error(res,'INVALID_STATE','Only draft campaigns can be confirmed.');const template=(c.template_id ? db.prepare('SELECT * FROM templates WHERE id=? AND user_id=?').get(c.template_id,req.userId) : undefined) as {name:string;approved:number}|undefined;if(config.mode==='live'&&(!template||!template.approved))return error(res,'TEMPLATE_REQUIRED','Live campaigns require an approved template.');const guests=db.prepare('SELECT * FROM guests WHERE event_id=? AND user_id=? AND consent=1 AND suppressed=0').all(c.event_id,req.userId) as {id:string;phone:string;name:string}[];const blocked=new Set((db.prepare('SELECT phone FROM suppressions WHERE user_id=?').all(req.userId) as {phone:string}[]).map(x=>x.phone));let sent=0,failed=0;for(const g of guests.filter(x=>!blocked.has(x.phone)).slice(0,100)){try{const r=await sendTemplate({to:g.phone,name:template?.name||'demo_event_update',parameters:[g.name]});db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),req.userId,c.event_id,g.id,c.id,'outbound',template?.name||'Demo event update',r.providerId,r.status,r.simulated?1:0,null,now());sent++;}catch(e){db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),req.userId,c.event_id,g.id,c.id,'outbound',template?.name||'',null,'failed',0,String(e).slice(0,300),now());failed++;}}db.prepare('UPDATE campaigns SET status=? WHERE id=?').run('Sent',c.id);audit(req.userId!,'campaign.confirmed',c.id);res.json({sent,failed,simulated:config.mode==='demo'});});

app.post('/api/ai/generate',requireAuth,async(req:AuthedRequest,res)=>{const p=z.object({event_id:z.string().uuid(),recipient:z.string().max(120).optional(),purpose:z.enum(['Invitation','Registration confirmation','Reminder','Update','Thank you','FAQ']),language:z.enum(['English','Hindi','Hinglish']),tone:z.enum(['Friendly','Professional','Formal','Festive']),length:z.enum(['Short','Medium','Long']),instructions:z.string().max(600).optional()}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Invalid AI request.');const event=db.prepare('SELECT * FROM events WHERE id=? AND user_id=?').get(p.data.event_id,req.userId) as Record<string,unknown>|undefined;if(!event)return error(res,'NOT_FOUND','Event not found.',404);try{res.json(await generateCopy({event,recipient:p.data.recipient,purpose:p.data.purpose,language:p.data.language,tone:p.data.tone,length:p.data.length,instructions:p.data.instructions}));}catch(e){error(res,'AI_ERROR',e instanceof Error?e.message:'AI generation failed.',502)}});

app.get('/api/messages',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT m.*,g.name guest_name FROM messages m LEFT JOIN guests g ON g.id=m.guest_id WHERE m.user_id=? ORDER BY m.created_at DESC LIMIT 100').all(req.userId)}));

app.get('/api/suppressions',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT * FROM suppressions WHERE user_id=? ORDER BY created_at DESC').all(req.userId)}));

app.post('/api/suppressions',requireAuth,(req:AuthedRequest,res)=>{const p=z.object({phone:z.string().regex(/^\+[1-9]\d{7,14}$/),reason:z.string().min(2).max(200)}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Use an E.164 phone number and a reason.');const recorded=now();db.prepare('INSERT OR IGNORE INTO suppressions VALUES (?,?,?,?,?)').run(id(),req.userId,p.data.phone,p.data.reason,recorded);const matching=db.prepare('SELECT id FROM guests WHERE user_id=? AND phone=? AND consent=1').all(req.userId,p.data.phone) as {id:string}[];db.prepare('UPDATE guests SET suppressed=1, consent=0 WHERE user_id=? AND phone=?').run(req.userId,p.data.phone);for(const guest of matching)db.prepare('INSERT INTO consent_records VALUES (?,?,?,?,?,?,?)').run(id(),req.userId,guest.id,'revoked',p.data.reason,'event messaging',recorded);audit(req.userId!,'suppression.added',p.data.phone);res.status(201).json({ok:true});});

app.get('/api/settings/whatsapp',requireAuth,async(_req,res)=>{try{res.json(await verifyWhatsApp());}catch{res.json({connected:false,mode:config.mode,reason:'Could not reach Meta to verify this configuration.'});}});

app.get('/api/jobs',requireAuth,(req:AuthedRequest,res)=>res.json({items:db.prepare('SELECT * FROM scheduled_jobs WHERE user_id=? ORDER BY run_at').all(req.userId)}));

app.post('/api/jobs',requireAuth,(req:AuthedRequest,res)=>{const p=z.object({campaign_id:z.string().uuid().nullable(),run_at:z.string().datetime(),type:z.enum(['24-hour reminder','2-hour reminder','Custom reminder','Registration confirmation','Event update'])}).safeParse(req.body);if(!p.success)return error(res,'VALIDATION','Invalid schedule.');const jid=id();db.prepare('INSERT INTO scheduled_jobs VALUES (?,?,?,?,?,?,?)').run(jid,req.userId,p.data.campaign_id,p.data.run_at,p.data.type,'Scheduled',0);res.status(201).json({id:jid,...p.data,status:'Scheduled'});});

app.post('/api/jobs/:id/:action',requireAuth,(req:AuthedRequest,res)=>{const status=req.params.action==='cancel'?'Cancelled':req.params.action==='pause'?'Paused':null;if(!status)return error(res,'VALIDATION','Unsupported job action.');db.prepare('UPDATE scheduled_jobs SET status=? WHERE id=? AND user_id=?').run(status,req.params.id,req.userId);res.json({ok:true});});

app.get('/api/webhooks/whatsapp',(req,res)=>{if(req.query['hub.verify_token']===config.whatsapp.verifyToken&&req.query['hub.mode']==='subscribe')return res.status(200).send(String(req.query['hub.challenge']||''));return res.sendStatus(403);});

app.post('/api/webhooks/whatsapp',(req:Request,res)=>{const raw=req.body as Buffer;if(!validSignature(raw,req.get('x-hub-signature-256')))return res.sendStatus(401);try{const payload=JSON.parse(raw.toString());const eventId=payload.entry?.[0]?.id+':'+payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;db.prepare('INSERT OR IGNORE INTO webhook_events VALUES (?,?,?,?)').run(id(),eventId||null,JSON.stringify(payload).slice(0,200000),now());}catch{return res.sendStatus(400)}res.sendStatus(200);});



// ================= SERVICES CATALOG API =================



const serviceSchema = z.object({

  name: z.string().trim().min(2).max(120),

  category: z.string().trim().min(2).max(80),

  price: z.number().min(0).max(100000000),

  pricingType: z.enum(["fixed", "starting", "quote"]),

  description: z.string().trim().min(2).max(3000),

  inclusions: z.array(z.string().trim().min(1).max(200)).max(30).default([]),

  addOns: z.array(z.string().trim().min(1).max(200)).max(30).default([]),

  availability: z.enum(["Available", "Limited", "Unavailable"]).default("Available"),

  location: z.string().max(250).default(""),

  published: z.boolean().default(false),

});



function getServiceImages(serviceId: string) {

  return db.prepare(`

    SELECT id, filename, original_name, mime_type, size

    FROM service_images

    WHERE service_id = ?

    ORDER BY created_at DESC

  `).all(serviceId).map((img: any) => ({

    ...img,

    url: `/uploads/${img.filename}`,

  }));

}



function getService(serviceId: string, userId: string) {

  const service = db.prepare(`

    SELECT * FROM services

    WHERE id = ? AND user_id = ?

  `).get(serviceId, userId) as any;



  if (!service) return null;



  return {

    ...service,

    price: service.price_paise / 100,

    inclusions: JSON.parse(service.inclusions || "[]"),

    addOns: JSON.parse(service.add_ons || "[]"),

    published: Boolean(service.published),

    images: getServiceImages(serviceId),

  };

}



// Admin: list all services belonging to the signed-in organizer.

app.get("/api/services", requireAuth, (req: AuthedRequest, res) => {

  const rows = db.prepare(`

    SELECT id FROM services

    WHERE user_id = ?

    ORDER BY created_at DESC

  `).all(req.userId!) as { id: string }[];



  res.json({

    items: rows.map(row => getService(row.id, req.userId!)),

  });

});



// Admin: create a service.

app.post("/api/services", requireAuth, (req: AuthedRequest, res) => {

  const parsed = serviceSchema.safeParse(req.body);



  if (!parsed.success) {

    return error(res, "VALIDATION", parsed.error.issues[0].message);

  }



  const p = parsed.data;

  const serviceId = id();

  const timestamp = now();



  db.prepare(`

    INSERT INTO services (

      id, user_id, name, category, price_paise, pricing_type,

      description, inclusions, add_ons, availability, location,

      published, created_at, updated_at

    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

  `).run(

    serviceId,

    req.userId,

    p.name,

    p.category,

    Math.round(p.price * 100),

    p.pricingType,

    p.description,

    JSON.stringify(p.inclusions),

    JSON.stringify(p.addOns),

    p.availability,

    p.location,

    p.published ? 1 : 0,

    timestamp,

    timestamp

  );



  audit(req.userId!, "service.created", serviceId);



  res.status(201).json({

    item: getService(serviceId, req.userId!),

  });

});



// Admin: edit a service.

app.patch("/api/services/:id", requireAuth, (req: AuthedRequest, res) => {

  const serviceId = String(req.params.id);

  const existing = getService(serviceId, req.userId!);



  if (!existing) {

    return error(res, "NOT_FOUND", "Service not found.", 404);

  }



  const parsed = serviceSchema.safeParse({

    ...existing,

    ...req.body,

  });



  if (!parsed.success) {

    return error(res, "VALIDATION", parsed.error.issues[0].message);

  }



  const p = parsed.data;



  db.prepare(`

    UPDATE services SET

      name = ?, category = ?, price_paise = ?, pricing_type = ?,

      description = ?, inclusions = ?, add_ons = ?, availability = ?,

      location = ?, published = ?, updated_at = ?

    WHERE id = ? AND user_id = ?

  `).run(

    p.name,

    p.category,

    Math.round(p.price * 100),

    p.pricingType,

    p.description,

    JSON.stringify(p.inclusions),

    JSON.stringify(p.addOns),

    p.availability,

    p.location,

    p.published ? 1 : 0,

    now(),

    serviceId,

    req.userId

  );



  audit(req.userId!, "service.updated", serviceId);



  res.json({ item: getService(serviceId, req.userId!) });

});



// Admin: upload service photos.

app.post(

  "/api/services/:id/images",

  requireAuth,

  (req: AuthedRequest, res, next) => {

    const serviceId = String(req.params.id);

    const owned = db.prepare(

      "SELECT id FROM services WHERE id = ? AND user_id = ?"

    ).get(serviceId, req.userId);



    if (!owned) {

      return error(res, "NOT_FOUND", "Service not found.", 404);

    }



    next();

  },

  upload.array("images", 8),

  (req: AuthedRequest, res) => {

    const files = (req.files || []) as Express.Multer.File[];



    if (!files.length) {

      return error(

        res,

        "NO_IMAGES",

        "Choose at least one JPG, PNG or WebP image."

      );

    }



    const validFiles: Express.Multer.File[] = [];



    for (const file of files) {

      if (!isRealImage(file.path, file.mimetype)) {

        fs.unlinkSync(file.path);

        continue;

      }



      validFiles.push(file);

    }



    if (!validFiles.length) {

      return error(res, "IMAGE_INVALID", "No valid image files were uploaded.");

    }



    const serviceId = String(req.params.id);

    const insert = db.prepare(`

      INSERT INTO service_images (

        id, service_id, filename, original_name,

        mime_type, size, created_at

      ) VALUES (?, ?, ?, ?, ?, ?, ?)

    `);



    const saveImages = db.transaction(() => {

      for (const file of validFiles) {

        insert.run(

          id(),

          serviceId,

          path.basename(file.filename),

          path.basename(file.originalname),

          file.mimetype,

          file.size,

          now()

        );

      }

    });



    saveImages();

    audit(req.userId!, "service.images_uploaded", serviceId);



    res.status(201).json({

      images: getServiceImages(serviceId),

    });

  }

);



// Admin: delete a service and its uploaded image files.

app.delete("/api/services/:id", requireAuth, (req: AuthedRequest, res) => {

  const serviceId = String(req.params.id);

  const service = db.prepare(`

    SELECT id FROM services WHERE id = ? AND user_id = ?

  `).get(serviceId, req.userId);



  if (!service) {

    return error(res, "NOT_FOUND", "Service not found.", 404);

  }



  const images = db.prepare(`

    SELECT filename FROM service_images WHERE service_id = ?

  `).all(serviceId) as { filename: string }[];



  for (const image of images) {

    const filename = path.basename(image.filename);

    const filePath = path.join(uploadsDir, filename);



    if (fs.existsSync(filePath)) {

      fs.unlinkSync(filePath);

    }

  }



  db.prepare("DELETE FROM service_images WHERE service_id = ?")

    .run(serviceId);



  db.prepare("DELETE FROM services WHERE id = ? AND user_id = ?")

    .run(serviceId, req.userId);



  audit(req.userId!, "service.deleted", serviceId);



  res.json({ ok: true });

});



// Public: visitors can only see published, available services.

app.get("/api/public/services", (_req, res) => {

  const rows = db.prepare(`

    SELECT id, user_id FROM services

    WHERE published = 1 AND availability != 'Unavailable'

    ORDER BY created_at DESC

  `).all() as { id: string; user_id: string }[];



  res.json({

    items: rows.map(row => {

      const service = getService(row.id, row.user_id);

      if (!service) return null;



      // Do not expose the organizer's internal user ID publicly.

      const { user_id, ...publicService } = service;

      return publicService;

    }).filter(Boolean),

  });

});



// ================= END SERVICES CATALOG API =================


// ================= BOOKING REQUEST API =================

// Customer creates a booking request for a published service.
app.post('/api/public/bookings', async (req: Request, res: Response) => {
  const parsed = z.object({
    serviceId: z.string().min(1),
    customerName: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(7).max(20),
    eventType: z.string().trim().min(2).max(100),
    preferredDate: z.string().min(1).max(30),
    location: z.string().trim().min(2).max(200),
    guestCount: z.number().int().min(1).max(100000),
    notes: z.string().max(1000).optional().default(''),
  }).safeParse(req.body);

  if (!parsed.success) {
    return error(res, 'VALIDATION', 'Please enter valid booking details.');
  }

 const service = db.prepare('SELECT id, user_id FROM services WHERE id = ? AND published = 1')
  .get(parsed.data.serviceId) as
  { id: string; user_id: string } | undefined;

  if (!service) {
    return error(res, 'NOT_FOUND', 'This service is not available.', 404);
  }

 const now = new Date().toISOString();
 const bookingId = crypto.randomUUID();
 const reference = `EW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  db.prepare(`
    INSERT INTO booking_requests (
      id, reference, service_id, user_id,
      customer_name, phone, event_type, preferred_date,
      location, guest_count, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, ?)
  `).run(
    bookingId,
    reference,
    service.id,
    service.user_id,
    parsed.data.customerName,
    parsed.data.phone,
    parsed.data.eventType,
    parsed.data.preferredDate,
    parsed.data.location,
    parsed.data.guestCount,
    parsed.data.notes,
    now,
    now
  );

  res.status(201).json({
    message: 'Booking request submitted successfully.',
    reference,
    status: 'New',
  });
});

// ================= END BOOKING REQUEST API =================


app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{console.error('Request error:',err instanceof Error?err.message:'unknown');error(res,'SERVER_ERROR','Unexpected server error.',500)});

if (process.env.NODE_ENV !== 'test') app.listen(config.port,()=>console.log(`EventWiz API listening on ${config.port} (${config.mode} mode)`));

export default app;