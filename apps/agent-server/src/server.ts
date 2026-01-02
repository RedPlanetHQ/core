import express from 'express';
import type { Server } from 'http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { whatsappWebhook } from './webhooks/whatsapp';
import { emailWebhook } from './webhooks/email';
import { verifyEndpoint } from './auth/verify';
import { chatEndpoint } from './routes/chat';

const app = express();

// Track all active connections
const connections = new Set<any>();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.post('/webhooks/whatsapp', whatsappWebhook);
app.post('/webhooks/email/inbound', emailWebhook);
app.get('/verify/:token', verifyEndpoint);

// API Routes (for testing)
app.post('/api/chat', chatEndpoint);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'agent-server',
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>CORE Agent Server</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 2rem;
          border-radius: 1rem;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 500px;
        }
        h1 { color: #667eea; margin-bottom: 1rem; }
        p { color: #666; line-height: 1.6; margin-bottom: 0.5rem; }
        .status { color: #10b981; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 CORE Agent Server</h1>
        <p class="status">● Online</p>
        <p>WhatsApp and Email agents with CORE memory integration</p>
        <p style="font-size: 0.875rem; color: #999; margin-top: 1rem;">
          Version 1.0.0 | Port ${env.PORT}
        </p>
      </div>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  process.on('exit', () => {
    logger.info('Process exiting');
  });
  try {
    // Start Express server
    const PORT = parseInt(env.PORT);
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Agent server running on port ${PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`CORE MCP Server: ${env.CORE_MCP_SERVER_URL}`);
      logger.info(`App Origin: ${env.APP_ORIGIN}`);
    });

    // Add this right after creating the server
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use. Retrying in 1 second...`);
        setTimeout(() => {
          server.close();
          server.listen(PORT, '0.0.0.0');
        }, 1000);
      }
    });

    // Track connections for clean shutdown
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => {
        connections.delete(conn);
      });
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');

      // Destroy all active connections immediately
      for (const conn of connections) {
        conn.destroy();
      }
      connections.clear();

      // Close the server
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });

      // Force exit if not closed within 2 seconds
      setTimeout(() => {
        logger.warn('Forcing shutdown');
        process.exit(0);
      }, 2000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Handle tsx watch restarts
    process.on('SIGUSR2', shutdown);
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
