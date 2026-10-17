import 'dotenv/config';
import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 8787),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  mode: process.env.APP_MODE === 'live' ? 'live' : 'demo',
  dbPath: process.env.DATABASE_PATH || path.resolve('data/eventwiz.db'),
  sessionSecret: process.env.SESSION_SECRET || 'demo-only-change-me',
  openAiKey: process.env.OPENAI_API_KEY || '',
  openAiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  whatsapp: {
    token: process.env.WHATSAPP_ACCESS_TOKEN || '', phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '', graphVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '', appSecret: process.env.META_APP_SECRET || ''
  }
};
export const isLiveConfigured = () => config.mode === 'live' && Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.appSecret);
