export function GET(): Response {
  return Response.json(
    { service: 'rbb-client', version: '0.1.0', protocol: 1, status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
