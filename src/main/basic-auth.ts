// HTTP basic auth for servers behind a reverse proxy (e.g. Nginx Proxy Manager access lists).
// Two layers: an Authorization header is added to requests to a saved server origin — and only
// those, the listener is filtered by url so other traffic never passes through it — which covers
// fetch, the WebSocket upgrade and static files alike; and the `login` event answers a challenge
// that still slips through, again only for the exact origin.

import { app, session } from 'electron';
import { decryptPassword, findServerByUrl, getSettings } from './settings';

const basicHeader = (username: string, passwordEnc: string) =>
  `Basic ${Buffer.from(`${username}:${decryptPassword(passwordEnc)}`, 'utf8').toString('base64')}`;

/** (re)installs the header listener for the current set of servers with credentials */
export const refreshBasicAuth = () => {
  const urls = getSettings()
    .servers.filter((s) => s.basicAuth)
    .map((s) => `${s.url}/*`);

  if (urls.length === 0) {
    session.defaultSession.webRequest.onBeforeSendHeaders(null);
    return;
  }

  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const server = findServerByUrl(details.url);

    if (server?.basicAuth && !details.requestHeaders['Authorization']) {
      details.requestHeaders['Authorization'] = basicHeader(server.basicAuth.username, server.basicAuth.passwordEnc);
    }

    callback({ requestHeaders: details.requestHeaders });
  });
};

export const installBasicAuth = () => {
  refreshBasicAuth();

  app.on('login', (event, _webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) return;

    const server = findServerByUrl(request.url);

    if (!server?.basicAuth) return; // Electron cancels the request; the page shows an error

    event.preventDefault();
    callback(server.basicAuth.username, decryptPassword(server.basicAuth.passwordEnc));
  });
};

/** Authorization header value for a server input (used by the connection test). */
export const basicHeaderFor = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
