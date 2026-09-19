import { PROTOCOL_VERSION } from '../src/shared/protocol';
import { version } from '../package.json';
export function GET(): Response {
  return Response.json(
    { service: 'rbb-client', version, protocol: PROTOCOL_VERSION, status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
