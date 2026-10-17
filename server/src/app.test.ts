
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventwiz-test-'));
process.env.DATABASE_PATH = path.join(testDir, 'eventwiz-test.db');
process.env.APP_MODE = 'demo';

let app: (typeof import('./index.js'))['default'];
let db: (typeof import('./db.js'))['db'];

beforeAll(async () => {
  // Import only after setting the temporary database path.
  const appModule = await import('./index.js');
  const dbModule = await import('./db.js');

  app = appModule.default;
  db = dbModule.db;

  const tables = [
    'consent_records',
    'messages',
    'guests',
    'campaigns',
    'scheduled_jobs',
    'audit_logs',
    'booking_requests',
    'service_images',
    'service_settings',
    'services',
    'templates',
    'events',
    'sessions',
    'suppressions',
    'webhook_events',
    'users',
  ];

  for (const table of tables) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const bcrypt = await import('bcryptjs');

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    '11111111-1111-4111-8111-111111111111',
    'test@example.local',
    await bcrypt.hash('TestPass123!', 10),
    'Test User',
    new Date().toISOString()
  );
}, 30000);

afterAll(() => {
  try {
    db?.close();
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

describe('core API safety', () => {
  it('reports demo mode and protects events', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/api/events')).status).toBe(401);
  });

  it('authenticates and rejects a guest without recorded consent source', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/api/auth/login')
      .send({
        email: 'test@example.local',
        password: 'TestPass123!',
      });

    expect(login.status).toBe(200);

    const csrf = login.body.csrfToken;

    const event = await agent
      .post('/api/events')
      .set('x-csrf-token', csrf)
      .send({
        name: 'Test Event',
        type: 'Conference',
        description: '',
        venue: 'Hall',
        map_url: '',
        start_at: '2026-12-01T10:00:00.000Z',
        end_at: '2026-12-01T11:00:00.000Z',
        timezone: 'Asia/Kolkata',
        registration_url: '',
        dress_code: '',
        parking: '',
        organizer_contact: '',
      });

    expect(event.status).toBe(201);

    const guest = await agent
      .post('/api/guests')
      .set('x-csrf-token', csrf)
      .send({
        event_id: event.body.id,
        name: 'No Proof',
        phone: '+919810000099',
        consent: true,
        consent_source: '',
      });

    expect(guest.status).toBe(400);
  });
});
