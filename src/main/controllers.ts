// Sony controllers (DualShock 4, DualSense) for saved servers, over WebHID: plugins like Jollyplay
// set the light bar and the like through navigator.hid, which a browser does after asking which
// device to use. Electron shows no chooser of its own and blocks hid unless the app allows it, so
// here: only saved servers' pages, only Sony's devices, and when such a page asks for a device,
// the first Sony controller connected is handed over without a prompt (a page that asks for
// one at all wants the controller in your hands). Everything else stays blocked: other hid
// devices, serial ports, usb.

import { session } from 'electron';
import { log } from './log';
import { findServerByUrl } from './settings';

/** Sony's USB vendor id (DualShock 4, DualSense, DualSense Edge) */
const SONY = 0x054c;

const fromSavedServer = (url: string | undefined | null) => !!url && !!findServerByUrl(url);

/** whether a permission check is hid for a saved server (the session's check handler asks) */
export const allowsHid = (permission: string, url: string) => permission === 'hid' && fromSavedServer(url);

export const installControllers = () => {
  const ses = session.defaultSession;

  // a device once picked (and getDevices() on later loads): sony's, for saved servers
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'hid') return false;
    const device = details.device as { vendorId?: number };
    return device.vendorId === SONY && fromSavedServer(details.origin);
  });

  // navigator.hid.requestDevice(): the first sony controller in the list (the page's own filters
  // already narrowed it), or none
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const pick = fromSavedServer(details.frame?.url) ? details.deviceList.find((d) => d.vendorId === SONY) : undefined;
    log('controllers', pick ? `gave a page ${pick.name || 'a sony controller'}` : `refused a device request (${details.deviceList.length} offered)`);
    callback(pick?.deviceId ?? null);
  });
};
