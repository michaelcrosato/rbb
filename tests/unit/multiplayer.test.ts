import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, worldInviteUrl } from '../../src/client/multiplayer';

describe('multiplayer addresses and invites', () => {
  it('normalizes addresses and enforces secure servers for HTTPS games', () => {
    expect(normalizeServerUrl(' ws://localhost:8787 ', 'http:')).toBe('ws://localhost:8787/');
    expect(normalizeServerUrl('wss://world.example/world', 'https:')).toBe(
      'wss://world.example/world',
    );
    expect(() => normalizeServerUrl('ws://world.example', 'https:')).toThrow(/secure/);
    for (const value of [
      'https://world.example',
      'wss://user:password@world.example',
      'wss://world.example?token=abc',
      'wss://world.example#abc',
      'not an address',
    ]) {
      expect(() => normalizeServerUrl(value, 'http:')).toThrow();
    }
  });
  it('shares only the server address and preserves the game path', () => {
    const invite = new URL(
      worldInviteUrl('wss://world.example/world', 'https://game.example/rbb/?old=value#fragment'),
    );
    expect(invite.origin + invite.pathname).toBe('https://game.example/rbb/');
    expect([...invite.searchParams.keys()]).toEqual(['world']);
    expect(invite.searchParams.get('world')).toBe('wss://world.example/world');
    expect(invite.hash).toBe('');
  });
});
