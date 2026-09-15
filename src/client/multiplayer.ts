/** Invite links carry only a server address. Resume credentials never belong in a URL. */
export function normalizeServerUrl(value: string, pageProtocol = location.protocol): string {
  const url = new URL(value.trim());
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'Use a ws:// or wss:// world-server address without credentials or a query string.',
    );
  if (pageProtocol === 'https:' && url.protocol !== 'wss:')
    throw new Error('An HTTPS game needs a secure wss:// server.');
  return url.toString();
}

export function worldInviteUrl(serverUrl: string, pageUrl = location.href): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('world', normalizeServerUrl(serverUrl, url.protocol));
  return url.toString();
}
