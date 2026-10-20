// HTTP basic auth for servers behind a reverse proxy (e.g. Nginx Proxy Manager access lists).
// Two layers: an Authorization header is added to every request to a known server origin
// (covers fetch, WebSocket upgrade and static files alike), and the `login` event answers any
// challenge that still slips through.

import { app, session } from 'electron';
import { decryptPassword, findServerByUrl, getSettings } from './settings';

const basicHeader = (username: string, passwordEnc: string) =>
  `Basic ${Buffer.from(`${username}:${decryptPassword(passwordEnc)}`, 'utf8').toString('base64')}`;

export const installBasicAuth = () => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const server = findServerByUrl(details.url);

    if (server?.basicAuth && !details.requestHeaders['Authorization']) {
      details.requestHeaders['Authorization'] = basicHeader(
        server.basicAuth.username,
        server.basicAuth.passwordEnc
      );
    }

    callback({ requestHeaders: details.requestHeaders });
  });

  app.on('login', (event, _webContents, request, authInfo, callback) => {
    if (authInfo.isProxy) return;

    const server =
      findServerByUrl(request.url) ??
      getSettings().servers.find((s) => new URL(s.url).host === `${authInfo.host}:${authInfo.port}`) ??
      getSettings().servers.find((s) => new URL(s.url).hostname === authInfo.host);

    if (!server?.basicAuth) return; // Electron cancels the request; the page shows an error

    event.preventDefault();
    callback(server.basicAuth.username, decryptPassword(server.basicAuth.passwordEnc));
  });
};

/** Authorization header value for a server input (used by the connection test). */
export const basicHeaderFor = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
