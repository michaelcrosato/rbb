import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorldServer } from '../../server/app';

const dir = await mkdtemp(join(tmpdir(), 'rbb-e2e-'));
import { testOrigins } from './server-options';
const server = await startWorldServer({
  port: 8788,
  host: '127.0.0.1',
  dataDir: dir,
  allowedOrigins: testOrigins,
});
const stop = () => {
  void server
    .close()
    .then(() => rm(dir, { recursive: true, force: true }))
    .finally(() => process.exit());
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
