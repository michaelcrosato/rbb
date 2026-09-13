import { startWorldServer } from './app';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be between 1 and 65535');
const origins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && !origins?.length)
  throw new Error('Set ALLOWED_ORIGINS to the exact HTTPS client origins in production.');
const world = await startWorldServer({
  port,
  allowDevTools: process.env.ALLOW_DEV_TOOLS === 'true',
  host: process.env.HOST,
  dataDir: process.env.DATA_DIR,
  seed: process.env.WORLD_SEED,
  allowedOrigins: origins,
});
const shutdown = () => {
  void world
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
