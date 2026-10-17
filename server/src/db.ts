import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, type TEXT NOT NULL, description TEXT DEFAULT '', venue TEXT DEFAULT '', map_url TEXT DEFAULT '', start_at TEXT NOT NULL, end_at TEXT NOT NULL, timezone TEXT NOT NULL, registration_url TEXT DEFAULT '', dress_code TEXT DEFAULT '', parking TEXT DEFAULT '', organizer_contact TEXT DEFAULT '', archived INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL REFERENCES events(id), name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', rsvp TEXT DEFAULT 'Pending', consent INTEGER DEFAULT 0, consent_source TEXT DEFAULT '', consent_at TEXT, suppressed INTEGER DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(event_id, phone));
CREATE TABLE IF NOT EXISTS consent_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), guest_id TEXT NOT NULL REFERENCES guests(id), status TEXT NOT NULL, source TEXT NOT NULL, purpose TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, approved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL REFERENCES events(id), name TEXT NOT NULL, template_id TEXT, status TEXT NOT NULL DEFAULT 'Draft', scheduled_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT, guest_id TEXT, campaign_id TEXT, direction TEXT NOT NULL, content TEXT NOT NULL, provider_id TEXT, status TEXT NOT NULL, simulated INTEGER DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suppressions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), phone TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,phone));
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, provider_event_id TEXT UNIQUE, payload TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), campaign_id TEXT, run_at TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Scheduled', attempts INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, subject TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_settings (user_id TEXT PRIMARY KEY REFERENCES users(id), whatsapp_number TEXT DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, category TEXT NOT NULL, price_paise INTEGER NOT NULL, pricing_type TEXT NOT NULL, description TEXT NOT NULL, inclusions TEXT NOT NULL DEFAULT '[]', add_ons TEXT NOT NULL DEFAULT '[]', availability TEXT NOT NULL DEFAULT 'Available', location TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_images (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_requests (id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, service_id TEXT NOT NULL REFERENCES services(id), user_id TEXT NOT NULL REFERENCES users(id), customer_name TEXT NOT NULL, phone TEXT NOT NULL, event_type TEXT NOT NULL, preferred_date TEXT NOT NULL, location TEXT NOT NULL, guest_count INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`);
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const audit = (userId: string, action: string, subject: string) => db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?)').run(id(), userId, action, subject, now());
