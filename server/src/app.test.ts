import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

// Integration tests are deliberately opt-in: point TEST_DATABASE_URL to an isolated,
// already-migrated PostgreSQL database. They never delete shared tables or SQLite files.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

it('serves health without implicitly migrating a database', async () => {
  const app = (await import('./index.js')).default;
  expect((await request(app).get('/health')).status).toBe(200);
}, 15_000);

describe.skipIf(!testDatabaseUrl)('PostgreSQL auth and isolation', () => {
  let app: (typeof import('./index.js'))['default'];
  let db: (typeof import('./db.js'))['db'];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = (await import('./index.js')).default;
    db = (await import('./db.js')).db;
  });
  afterAll(async () => {
    for (const userId of createdUserIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    await db.close();
  });
  const signup = async (agent: ReturnType<typeof request.agent>, suffix: string) => {
    const response = await agent.post('/api/auth/signup').send({ name: `Test ${suffix}`, email: `eventwiz-${suffix}-${crypto.randomUUID()}@example.test`, password: 'ValidPass123!' });
    expect(response.status).toBe(200);
    createdUserIds.push(response.body.user.id);
    return response;
  };

  it('validates signup and handles duplicate emails', async () => {
    const email = `duplicate-${crypto.randomUUID()}@example.test`;
    const first = await request(app).post('/api/auth/signup').send({ name: 'Duplicate Test', email, password: 'ValidPass123!' });
    expect(first.status).toBe(200);
    createdUserIds.push(first.body.user.id);
    const duplicate = await request(app).post('/api/auth/signup').send({ name: 'Duplicate Test', email, password: 'ValidPass123!' });
    expect(duplicate.status).toBe(409);
    expect((await request(app).post('/api/auth/signup').send({ name: 'Weak', email: `weak-${crypto.randomUUID()}@example.test`, password: 'weak' })).status).toBe(400);
  });

  it('isolates one organizer’s events from another', async () => {
    const first = request.agent(app); const second = request.agent(app);
    const firstSignup = await signup(first, 'one'); const secondSignup = await signup(second, 'two');
    const event = await first.post('/api/events').set('x-csrf-token', firstSignup.body.csrfToken).send({ name:'Private Event',type:'Conference',description:'',venue:'Hall',map_url:'',start_at:'2027-01-01T10:00:00.000Z',end_at:'2027-01-01T11:00:00.000Z',timezone:'Asia/Kolkata',registration_url:'',dress_code:'',parking:'',organizer_contact:'' });
    expect(event.status).toBe(201);
    expect((await second.get('/api/events')).body.items).toEqual([]);
    expect((await second.post(`/api/events/${event.body.id}/archive`).set('x-csrf-token', secondSignup.body.csrfToken)).status).toBe(404);
  });
});
