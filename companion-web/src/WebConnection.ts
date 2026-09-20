/** The web build and its WebSockets share one host, including through an HTTPS tunnel. */
export function defaultPlayServerUrl(pageUrl: string): string {
  const url = new URL('/play', pageUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** Apply a newly bundled team endpoint once, then respect later settings edits. */
export function nativeServerSelection(configured: string | undefined, previouslyApplied: string | null, saved: string | null) {
  const changed = !!configured && configured !== previouslyApplied;
  return { url: changed ? configured : saved || configured, changed };
}

export function createInviteUrl(pageUrl: string, serverUrl: string, roomCode: string, nativeWebUrl?: string): string {
  const server = new URL(serverUrl);
  const page = new URL(pageUrl);
  // Native pages use bondimals://. Their invitations must open the hosted web app.
  const browserPage = ['http:', 'https:'].includes(page.protocol);
  const hostedNativeInvite = !browserPage && !!nativeWebUrl;
  const url = browserPage ? page : nativeWebUrl ? new URL(nativeWebUrl) : new URL('/', server);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The browser invite needs an HTTP or HTTPS address.');
  // The configured hosted web app forwards to the same team server. Never send
  // its private ws:// LAN address to an HTTPS browser as an override.
  if (!hostedNativeInvite && server.href !== defaultPlayServerUrl(url.href)) url.searchParams.set('server', server.href);
  return url.href;
}
