import { PROTOCOL_VERSION } from '../src/shared/protocol-version.js';
import pkg from '../package.json' with { type: 'json' };
export function GET(): Response {
  return Response.json(
    { service: 'rbb-client', version: pkg.version, protocol: PROTOCOL_VERSION, status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
