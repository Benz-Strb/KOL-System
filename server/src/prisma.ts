import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Cloudflare Workers has no module-level singleton across requests — create a
// fresh PrismaClient (backed by a pg Pool through Hyperdrive) per request instead.
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}
