// HTTP basic auth for servers behind a reverse proxy (e.g. Nginx Proxy Manager access lists).
// The page's own request is answered through the `login` event, exactly like a browser prompt:
// that puts the credentials into chromium's auth cache, which is what the websocket handshake
// uses — webRequest hooks never see handshakes, so pre-filling the header alone leaves the
// websocket unauthenticated (verified against a fake proxy). Subresources get the header
// directly from a url-filtered hook, which saves them the round trip.

import { app, session } from 'electron';
import { decryptPassword, findServerByUrl, onServersChanged, getSettings } from './settings';

const basicHeader = (username: string, passwordEnc: string) =>
  `Basic ${Buffer.from(`${username}:${decryptPassword(passwordEnc)}`, 'utf8').toString('base64')}`;

/** (re)installs the header listener for the current set of servers with credentials */
export const refreshBasicAuth = () => {
  // the websocket handshake is its own scheme as far as url patterns go
  const urls = getSettings()
    .servers.filter((s) => s.basicAuth)
    .flatMap((s) => [`${s.url}/*`, `${s.url.replace(/^http/, 'ws')}/*`]);

  if (urls.length === 0) {
    session.defaultSession.webRequest.onBeforeSendHeaders(null);
    return;
  }

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const server = findServerByUrl(details.url);

    // the page itself is left to the real challenge: answering it through `login` puts the
    // credentials into chromium's auth cache, which is the only thing a websocket handshake
    // consults (this hook never sees handshakes). everything else gets the header directly.
    if (details.resourceType === 'mainFrame') return callback({});

    if (server?.basicAuth && !details.requestHeaders['Authorization']) {
      details.requestHeaders['Authorization'] = basicHeader(server.basicAuth.username, server.basicAuth.passwordEnc);
    }

    callback({ requestHeaders: details.requestHeaders });
  });
};

export const installBasicAuth = () => {
  refreshBasicAuth();

  // a wrong stored password would otherwise be offered dozens of times per page load
  const attempts = new Map<string, { n: number; at: number }>();
  onServersChanged(() => attempts.clear()); // a corrected password gets a fresh try

  app.on('login', (event, _webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) return;

    const server = findServerByUrl(request.url);

    if (!server?.basicAuth) return; // Electron cancels the request; the page shows an error

    const now = Date.now();
    const a = attempts.get(server.url);
    const n = a && now - a.at < 10_000 ? a.n + 1 : 1;
    attempts.set(server.url, { n, at: now });

    if (n > 3) return; // the proxy keeps refusing these credentials: stop and let the 401 show

    event.preventDefault();
    callback(server.basicAuth.username, decryptPassword(server.basicAuth.passwordEnc));
  });
};

/** Authorization header value for a server input (used by the connection test). */
export const basicHeaderFor = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
