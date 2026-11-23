import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function getLanIpAddress(): string | null {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        candidates.push(entry.address);
      }
    }
  }

  // Preferisce indirizzi LAN privati tipici (192.168.x.x / 10.x.x.x)
  const preferred =
    candidates.find((ip) => ip.startsWith('192.168.')) ||
    candidates.find((ip) => ip.startsWith('10.')) ||
    candidates[0];

  return preferred ?? null;
}

function attachCardsSyncMiddleware(middlewares: Connect.Server, fallbackPort: number) {
  const syncFilePath = path.resolve(process.cwd(), 'cards-sync.json');

  middlewares.use('/api/sync-cards', (req: IncomingMessage, res: ServerResponse, next) => {
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      let cards: unknown[] = [];
      try {
        if (fs.existsSync(syncFilePath)) {
          const raw = fs.readFileSync(syncFilePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            cards = parsed;
          } else if (parsed && Array.isArray(parsed.cards)) {
            cards = parsed.cards;
          }
        }
      } catch {
        cards = [];
      }

      const hostHeader = req.headers.host || '';
      const portMatch = hostHeader.match(/:(\d+)$/);
      const port = portMatch ? portMatch[1] : String(fallbackPort);
      const lanIp = getLanIpAddress();
      const lanUrl = lanIp ? `http://${lanIp}:${port}` : null;

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ cards, lanUrl }));
      return;
    }

    if (method === 'POST') {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const MAX_BODY = 20 * 1024 * 1024; // 20MB per eventuali foto allegate

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize <= MAX_BODY) {
          chunks.push(chunk);
        }
      });

      req.on('end', () => {
        if (totalSize > MAX_BODY) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Payload troppo grande' }));
          return;
        }
        try {
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(bodyStr);
          const cards = Array.isArray(parsed)
            ? parsed
            : parsed && Array.isArray(parsed.cards)
              ? parsed.cards
              : null;

          if (!cards) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Formato cards non valido' }));
            return;
          }

          fs.writeFileSync(
            syncFilePath,
            JSON.stringify({ updatedAt: new Date().toISOString(), cards }, null, 2),
            'utf-8'
          );

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, count: cards.length }));
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'JSON non valido' }));
        }
      });
      return;
    }

    next();
  });
}

function localCardsSyncPlugin(): Plugin {
  return {
    name: 'local-cards-sync',
    configureServer(server) {
      attachCardsSyncMiddleware(server.middlewares, server.config.server.port || 5173);
    },
    configurePreviewServer(server) {
      attachCardsSyncMiddleware(server.middlewares, server.config.preview.port || 4173);
    },
  };
}

export default defineConfig(({ command }) => {
  const basePath = command === 'build' ? '/CarteFedelta/' : '/';

  return {
    base: basePath,
    plugins: [
      localCardsSyncPlugin(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          name: 'Carte Fedeltà Wallet',
          short_name: 'Carte Fedeltà',
          description: 'Memorizza le tue carte fedeltà offline, scansione da fotocamera e importazione da Klarna.',
          theme_color: '#0f172a',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'portrait',
          start_url: basePath,
          scope: basePath,
          lang: 'it',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      host: true,
      port: 5173,
    },
  };
});
