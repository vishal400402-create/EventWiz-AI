import crypto from 'node:crypto';
import { config, isLiveConfigured } from './config.js';

export async function verifyWhatsApp() {
  if (!isLiveConfigured()) return { connected: false, mode: config.mode, reason: config.mode === 'demo' ? 'Demo mode uses simulated delivery.' : 'Live credentials are incomplete.' };
  const url = `https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${config.whatsapp.token}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return { connected: false, mode: 'live', reason: `Meta verification failed (${response.status}).` };
  const data = await response.json() as {display_phone_number?:string};
  return { connected: true, mode: 'live', phone: data.display_phone_number || 'Verified number' };
}

export async function sendTemplate(input: { to: string; name: string; language?: string; parameters?: string[] }) {
  if (config.mode === 'demo') return { providerId: `demo_${crypto.randomUUID()}`, status: 'simulated_delivered', simulated: true };
  if (!isLiveConfigured()) throw new Error('Live mode is enabled but official WhatsApp credentials are incomplete.');
  const payload = { messaging_product: 'whatsapp', to: input.to.replace(/^\+/, ''), type: 'template', template: { name: input.name, language: { code: input.language || 'en_US' }, components: input.parameters?.length ? [{ type: 'body', parameters: input.parameters.map(text => ({ type: 'text', text })) }] : [] } };
  const response = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const data = await response.json() as {messages?:{id:string}[]; error?:{message?:string}};
  if (!response.ok) throw new Error(data.error?.message || `WhatsApp API returned ${response.status}`);
  return { providerId: data.messages?.[0]?.id || '', status: 'sent', simulated: false };
}

export function validSignature(raw: Buffer, signature?: string) {
  if (!config.whatsapp.appSecret || !signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(raw).digest('hex')}`;
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function generateCopy(details: { event: Record<string, unknown>; recipient?: string; purpose: string; language: string; tone: string; length: string; instructions?: string }) {
  const facts = { name: details.event.name, venue: details.event.venue, start_at: details.event.start_at, end_at: details.event.end_at, timezone: details.event.timezone, registration_url: details.event.registration_url, dress_code: details.event.dress_code, parking: details.event.parking };
  if (!config.openAiKey) return { demo: true, text: `Hi ${details.recipient || 'there'}, you're invited to ${facts.name}. ${facts.venue ? `Venue: ${facts.venue}. ` : ''}${facts.start_at ? `Starts: ${new Date(String(facts.start_at)).toLocaleString('en-IN', { timeZone: String(facts.timezone || 'UTC') })}. ` : ''}${facts.registration_url ? `RSVP here: ${facts.registration_url}` : 'Please contact the organizer to RSVP.'}` };
  const prompt = `Write one WhatsApp ${details.purpose} in ${details.language}, tone ${details.tone}, length ${details.length}. Use ONLY this verified JSON; do not invent any fact. If a requested fact is absent, omit it. ${details.instructions || ''}\n${JSON.stringify(facts)}`;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.openAiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.openAiModel, input: prompt }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('AI generation failed. Check server-side OpenAI configuration.');
  const data = await response.json() as { output_text?: string };
  return { demo: false, text: data.output_text || 'No response generated.' };
}
