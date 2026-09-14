export function GET(): Response {
  return Response.json(
    { service: 'rbb-client', version: '0.3.0', protocol: 2, status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
