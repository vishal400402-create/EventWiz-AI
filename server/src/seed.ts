import bcrypt from 'bcryptjs'; import { db, id, now } from './db.js';
const userId='00000000-0000-4000-8000-000000000001'; const eventId='00000000-0000-4000-8000-000000000010';
db.prepare('DELETE FROM messages').run(); db.prepare('DELETE FROM guests').run(); db.prepare('DELETE FROM templates').run(); db.prepare('DELETE FROM campaigns').run(); db.prepare('DELETE FROM events').run(); db.prepare('DELETE FROM sessions').run(); db.prepare('DELETE FROM users').run();
db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(userId,'demo@eventwiz.local',await bcrypt.hash('DemoPass123!',12),'Aarav Sharma',now());
db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId,userId,'Aarav & Meera Wedding','Wedding','A joyful evening with dinner and music.','The Garden Pavilion','', '2026-11-20T12:30:00.000Z','2026-11-20T18:30:00.000Z','Asia/Kolkata','https://example.com/rsvp','Festive Indian','Valet parking at the south gate','Aarav: +919000000000',0,now());
const guests=[['Priya Nair','+919810000001','Attending',1,'Wedding RSVP form'],['Rohan Mehta','+919810000002','Pending',1,'Event registration'],['Neha Kapoor','+919810000003','Maybe',0,''],['Vikram Shah','+919810000004','Not Attending',1,'Paper sign-up']];
for(const [name,phone,rsvp,consent,source] of guests) db.prepare('INSERT INTO guests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),userId,eventId,name,phone,'',rsvp,consent,source,consent?now():null,0,now());
db.prepare('INSERT INTO templates VALUES (?,?,?,?,?,?)').run('00000000-0000-4000-8000-000000000020',userId,'event_reminder','UTILITY','Hello {{1}}, a reminder about {{2}}.',1);
console.log('Demo database seeded. Login: demo@eventwiz.local / DemoPass123!');
