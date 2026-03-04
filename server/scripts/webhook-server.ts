#!/usr/bin/env node
/**
 * Lightweight webhook receiver for GitHub push events.
 * Triggers auto-deploy.sh when a push is received.
 *
 * Usage:
 *   WEBHOOK_SECRET=your-secret node webhook-server.js
 *   or: npx tsx server/scripts/webhook-server.ts
 *
 * GitHub Webhook URL: http://your-server:9000/webhook
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { execSync, exec } from 'child_process';
import * as path from 'path';

const PORT = parseInt(process.env.WEBHOOK_PORT ?? '9000', 10);
const SECRET = process.env.WEBHOOK_SECRET ?? '';
const DEPLOY_SCRIPT = path.resolve(__dirname, 'auto-deploy.sh');
const ALLOWED_BRANCHES = (process.env.WEBHOOK_BRANCHES ?? 'main,master').split(',');

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!SECRET) return true; // No secret = no verification (dev mode)
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(payload);
  const expected = `sha256=${hmac.digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', () => {
      // Verify signature
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      if (!verifySignature(body, sig)) {
        log('REJECTED: Invalid signature');
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      try {
        const payload = JSON.parse(body);
        const ref = payload.ref ?? '';
        const branch = ref.replace('refs/heads/', '');
        const pusher = payload.pusher?.name ?? 'unknown';
        const commitMsg = payload.head_commit?.message ?? '';

        log(`Push received: ${branch} by ${pusher} - ${commitMsg}`);

        // Only deploy for allowed branches
        if (!ALLOWED_BRANCHES.includes(branch)) {
          log(`Skipping: branch "${branch}" not in allowed list`);
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'skipped', reason: 'branch not allowed' }));
          return;
        }

        // Trigger deploy in background
        log(`Deploying branch: ${branch}`);
        exec(`bash ${DEPLOY_SCRIPT}`, { env: { ...process.env, DEPLOY_BRANCH: branch } }, (err, stdout, stderr) => {
          if (err) {
            log(`Deploy error: ${err.message}`);
          } else {
            log(`Deploy complete for ${branch}`);
          }
          if (stdout) log(`stdout: ${stdout}`);
          if (stderr) log(`stderr: ${stderr}`);
        });

        res.writeHead(200);
        res.end(JSON.stringify({ status: 'deploying', branch }));

      } catch (err: any) {
        log(`Parse error: ${err.message}`);
        res.writeHead(400);
        res.end('Bad Request');
      }
    });

    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Webhook server listening on port ${PORT}`);
  log(`Health: http://localhost:${PORT}/health`);
  log(`Webhook: http://localhost:${PORT}/webhook`);
  if (!SECRET) log('WARNING: No WEBHOOK_SECRET set - signature verification disabled');
});
