import { describe, expect, it } from 'vitest';
import { createInviteUrl, defaultPlayServerUrl, nativeServerSelection } from './WebConnection';

describe('shareable web connections', () => {
  it('keeps HTTPS tunnels and local IPv6 WebSockets on the page host', () => {
    expect(defaultPlayServerUrl('https://friends.example/?room=ABC234')).toBe('wss://friends.example/play');
    expect(defaultPlayServerUrl('http://[::1]:5217/')).toBe('ws://[::1]:5217/play');
  });
  it('shares the room without carrying old parameters or private credentials', () => {
    expect(createInviteUrl('https://friends.example/?playerToken=private#debug', 'wss://friends.example/play', 'ABC234'))
      .toBe('https://friends.example/?room=ABC234');
  });
  it('preserves a separately configured server and static-host subdirectory', () => {
    const invite = new URL(createInviteUrl('https://site.example/phone/', 'wss://game.example/play', 'ABC234'));
    expect(invite.pathname).toBe('/phone/');
    expect(invite.searchParams.get('server')).toBe('wss://game.example/play');
  });
  it('opens native app invitations in the hosted browser game', () => {
    expect(createInviteUrl('bondimals://app/index.html', 'wss://friends.example/play', 'ABC234'))
      .toBe('https://friends.example/?room=ABC234');
  });
  it('shares native LAN rooms through the HTTPS web gateway without a mixed-content override', () => {
    expect(createInviteUrl('bondimals://app/index.html', 'ws://10.189.108.228:8788/play', 'ABC234', 'https://friends.example/'))
      .toBe('https://friends.example/?room=ABC234');
  });
  it('migrates an old saved endpoint when the installed app receives a new team server', () => {
    expect(nativeServerSelection('ws://new.example/play', 'ws://old.example/play', 'ws://old.example/play'))
      .toEqual({ url: 'ws://new.example/play', changed: true });
  });
  it('preserves a deliberate settings change on later launches of the same build', () => {
    expect(nativeServerSelection('ws://team.example/play', 'ws://team.example/play', 'ws://chosen.example/play'))
      .toEqual({ url: 'ws://chosen.example/play', changed: false });
    expect(nativeServerSelection(undefined, null, 'wss://web.example/play'))
      .toEqual({ url: 'wss://web.example/play', changed: false });
  });
});
