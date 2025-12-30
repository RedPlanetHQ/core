import { PrismaClient } from '@core/database';
import { env } from './config/env';

let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

// This is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to the DB with every change either.
if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
  });
  prisma.$connect();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      datasources: {
        db: {
          url: env.DATABASE_URL,
        },
      },
    });
    global.__prisma.$connect();
  }
  prisma = global.__prisma;
}

export { prisma };
