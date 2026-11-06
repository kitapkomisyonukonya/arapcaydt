import geminiVoiceHandler from './api/gemini/generate';
import geminiAlignHandler from './api/gemini/align-project';
import geminiJoinHandler from './api/gemini/join-parts';
import geminiKeyHandler from './api/gemini/key';
import visionOcrHandler from './api/vision/ocr';
import voiceStatusHandler from './api/elevenlabs/status';
import voiceListHandler from './api/elevenlabs/voices';
import elevenLabsProjectAlignHandler from './api/elevenlabs/align-project';
import analyticsHandler from './api/admin/analytics';
import storageHandler from './api/admin/storage';
import setRoleHandler from './api/admin/set-role';
import monitorHandler from './api/admin/monitor';
import { requireMember } from './server/auth';
import { R2_PROXY, r2Config } from './server/r2';
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

// Security headers for the Node server (npm start). Framing stays allowed here because
// AI Studio previews this server in a frame; the Vercel site forbids framing (vercel.json).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), fullscreen=(self)');
  next();
});
app.use(express.json({ limit: '50mb' }));

/**
 * Express 4 does not catch a rejected async handler: the request would never be answered and the
 * teacher's spinner would turn forever. Every API handler's failure becomes a plain 500 instead.
 */
const safe = (handler: (req: any, res: any) => unknown) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Promise.resolve().then(() => handler(req, res)).catch(next);
};

app.get('/api/elevenlabs/status', safe(voiceStatusHandler));
app.get('/api/elevenlabs/voices', safe(voiceListHandler));
app.post('/api/gemini/generate', safe(geminiVoiceHandler));
app.post('/api/gemini/align-project', safe(geminiAlignHandler));
app.post('/api/gemini/join-parts', safe(geminiJoinHandler));
app.post('/api/vision/ocr', safe(visionOcrHandler));
app.all('/api/gemini/key', safe(geminiKeyHandler));
app.post('/api/elevenlabs/align-project', safe(elevenLabsProjectAlignHandler));
// Same handlers Vercel serves from api/, so the admin panel also works in local development.
app.get('/api/admin/analytics', safe(analyticsHandler));
app.all('/api/admin/storage', safe(storageHandler));
app.post('/api/admin/set-role', safe(setRoleHandler));
app.get('/api/admin/monitor', safe(monitorHandler));
app.post('/api/admin/monitor', safe(monitorHandler));
// What vercel.json's /r2 rewrite does on the Vercel site: storage links go through this server.
app.all(`${R2_PROXY}/*`, safe(async (req: express.Request, res: express.Response) => {
  const c = r2Config();
  if (!c) return res.status(404).end();
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'content-length', 'range']) if (req.headers[name]) headers[name] = String(req.headers[name]);
  const upstream = await fetch(`https://${c.accountId}.r2.cloudflarestorage.com${req.originalUrl.slice(R2_PROXY.length)}`,
    { method: req.method, headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req as any, duplex: 'half' }) } as RequestInit);
  res.status(upstream.status);
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.end(Buffer.from(await upstream.arrayBuffer()));
}));
app.use('/api', safe(async(req,res)=>{if(await requireMember(req,res))res.status(404).json({ error: 'Bulunamadı.' });}));
app.use('/api', (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api]', error instanceof Error ? error.message : error);
  if (!res.headersSent) res.status(500).json({ error: 'Sunucuda beklenmeyen bir hata oldu. Biraz sonra tekrar deneyin.' });
});

// Production / Dev Vite static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Teacher Studio Server running on port ${PORT}`);
  });
}

startServer();
