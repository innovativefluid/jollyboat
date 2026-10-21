// A minimal D-Bus client for one job: asking xdg-desktop-portal's Background portal to start
// Jollyboat with the system. Inside Flatpak (and on Flathub) the app may not write to
// ~/.config/autostart, the portal does it for us. Only what this call needs is implemented:
// little-endian messages, EXTERNAL auth, method calls and the Request::Response signal.

import { createConnection, type Socket } from 'node:net';
import { log } from './log';

type TValue = string | number | boolean | bigint | TValue[] | Map<string, TValue> | TVariant;
type TVariant = { sig: string; value: TValue };

const variant = (sig: string, value: TValue): TVariant => ({ sig, value });

// --- marshalling ------------------------------------------------------------------------------

class Writer {
  private bytes: number[] = [];

  get length() {
    return this.bytes.length;
  }

  align(n: number) {
    while (this.bytes.length % n) this.bytes.push(0);
  }

  u8(v: number) {
    this.bytes.push(v & 0xff);
  }

  u32(v: number) {
    this.align(4);
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    this.bytes.push(...b);
  }

  setU32(at: number, v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    this.bytes.splice(at, 4, ...b);
  }

  str(v: string) {
    const b = Buffer.from(v, 'utf8');
    this.u32(b.length);
    this.bytes.push(...b, 0);
  }

  sig(v: string) {
    this.u8(v.length);
    this.bytes.push(...Buffer.from(v, 'ascii'), 0);
  }

  buffer() {
    return Buffer.from(this.bytes);
  }
}

/** splits a signature into its complete types: "sa{sv}" → ["s", "a{sv}"] */
const splitSig = (sig: string) => {
  const out: string[] = [];
  let i = 0;

  const one = (): string => {
    const c = sig[i++];
    if (c === 'a') return 'a' + one();
    if (c === '(' || c === '{') {
      const close = c === '(' ? ')' : '}';
      let s = c;
      while (sig[i] !== close) s += one();
      i++;
      return s + close;
    }
    return c ?? '';
  };

  while (i < sig.length) out.push(one());
  return out;
};

const alignOf = (t: string) => ({ y: 1, g: 1, v: 1, n: 2, q: 2, b: 4, i: 4, u: 4, s: 4, o: 4, a: 4, x: 8, t: 8, d: 8, '(': 8, '{': 8 })[t[0]!] ?? 1;

const write = (w: Writer, t: string, v: TValue) => {
  switch (t[0]) {
    case 'y':
      return w.u8(v as number);
    case 'b':
      return w.u32(v ? 1 : 0);
    case 'u':
    case 'i':
      return w.u32(v as number);
    case 's':
    case 'o':
      return w.str(v as string);
    case 'g':
      return w.sig(v as string);
    case 'v': {
      const { sig, value } = v as TVariant;
      w.sig(sig);
      return write(w, sig, value);
    }
    case 'a': {
      const inner = t.slice(1);
      w.u32(0);
      const lengthAt = w.length - 4;
      w.align(alignOf(inner));
      const start = w.length;
      if (inner[0] === '{') {
        const [k, val] = splitSig(inner.slice(1, -1));
        for (const [key, value] of v as Map<string, TValue>) {
          w.align(8);
          write(w, k!, key);
          write(w, val!, value);
        }
      } else {
        for (const item of v as TValue[]) write(w, inner, item);
      }
      w.setU32(lengthAt, w.length - start);
      return;
    }
    case '(': {
      w.align(8);
      const parts = splitSig(t.slice(1, -1));
      parts.forEach((p, i) => write(w, p, (v as TValue[])[i]!));
      return;
    }
    default:
      throw new Error(`dbus: cannot write ${t}`);
  }
};

class Reader {
  private buf: Buffer;
  pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  align(n: number) {
    this.pos = Math.ceil(this.pos / n) * n;
  }

  read(t: string): TValue {
    this.align(alignOf(t));
    switch (t[0]) {
      case 'y':
        return this.buf.readUInt8(this.pos++);
      case 'b':
        return this.u32() !== 0;
      case 'n':
        this.pos += 2;
        return this.buf.readInt16LE(this.pos - 2);
      case 'q':
        this.pos += 2;
        return this.buf.readUInt16LE(this.pos - 2);
      case 'i':
        this.pos += 4;
        return this.buf.readInt32LE(this.pos - 4);
      case 'u':
        return this.u32();
      case 'x':
        this.pos += 8;
        return this.buf.readBigInt64LE(this.pos - 8);
      case 't':
        this.pos += 8;
        return this.buf.readBigUInt64LE(this.pos - 8);
      case 'd':
        this.pos += 8;
        return this.buf.readDoubleLE(this.pos - 8);
      case 's':
      case 'o': {
        const n = this.u32();
        const s = this.buf.toString('utf8', this.pos, this.pos + n);
        this.pos += n + 1;
        return s;
      }
      case 'g': {
        const n = this.buf.readUInt8(this.pos++);
        const s = this.buf.toString('ascii', this.pos, this.pos + n);
        this.pos += n + 1;
        return s;
      }
      case 'v': {
        const sig = this.read('g') as string;
        return variant(sig, this.read(sig));
      }
      case 'a': {
        const inner = t.slice(1);
        const n = this.u32();
        this.align(alignOf(inner));
        const end = this.pos + n;
        if (inner[0] === '{') {
          const [k, val] = splitSig(inner.slice(1, -1));
          const map = new Map<string, TValue>();
          while (this.pos < end) {
            this.align(8);
            const key = this.read(k!);
            map.set(String(key), this.read(val!));
          }
          return map;
        }
        const list: TValue[] = [];
        while (this.pos < end) list.push(this.read(inner));
        return list;
      }
      case '(': {
        this.align(8);
        return splitSig(t.slice(1, -1)).map((p) => this.read(p));
      }
      default:
        throw new Error(`dbus: cannot read ${t}`);
    }
  }

  u32() {
    this.pos += 4;
    return this.buf.readUInt32LE(this.pos - 4);
  }
}

// --- messages ---------------------------------------------------------------------------------

type TMessage = {
  type: number;
  serial: number;
  replySerial?: number;
  path?: string;
  iface?: string;
  member?: string;
  sender?: string;
  errorName?: string;
  body: TValue[];
};

const FIELD = { path: 1, iface: 2, member: 3, errorName: 4, replySerial: 5, destination: 6, sender: 7, signature: 8 };

const encode = (
  serial: number,
  m: { path: string; iface: string; member: string; destination: string; sig?: string; body?: TValue[] }
) => {
  const body = new Writer();
  splitSig(m.sig ?? '').forEach((t, i) => write(body, t, m.body![i]!));
  const bodyBuf = body.buffer();

  const fields: TValue[] = [
    [FIELD.path, variant('o', m.path)],
    [FIELD.iface, variant('s', m.iface)],
    [FIELD.member, variant('s', m.member)],
    [FIELD.destination, variant('s', m.destination)]
  ];
  if (m.sig) fields.push([FIELD.signature, variant('g', m.sig)]);

  const head = new Writer();
  head.u8(0x6c); // 'l'
  head.u8(1); // method call
  head.u8(0);
  head.u8(1); // protocol version
  head.u32(bodyBuf.length);
  head.u32(serial);
  write(head, 'a(yv)', fields);
  head.align(8);

  return Buffer.concat([head.buffer(), bodyBuf]);
};

/** one complete message from the front of buf, or null if it has not all arrived */
const decode = (buf: Buffer): { message: TMessage; size: number } | null => {
  if (buf.length < 16) return null;
  if (buf[0] !== 0x6c) throw new Error('dbus: big-endian messages are not supported');

  const bodyLength = buf.readUInt32LE(4);
  const fieldsLength = buf.readUInt32LE(12);
  const headerEnd = Math.ceil((16 + fieldsLength) / 8) * 8;
  const size = headerEnd + bodyLength;
  if (buf.length < size) return null;

  const r = new Reader(buf, 12);
  const fields = r.read('a(yv)') as [number, TVariant][];
  const field = (code: number) => fields.find(([c]) => c === code)?.[1].value;

  const sig = (field(FIELD.signature) as string | undefined) ?? '';
  const br = new Reader(buf.subarray(headerEnd, size));
  const body = splitSig(sig).map((t) => br.read(t));

  return {
    size,
    message: {
      type: buf[1]!,
      serial: buf.readUInt32LE(8),
      replySerial: field(FIELD.replySerial) as number | undefined,
      path: field(FIELD.path) as string | undefined,
      iface: field(FIELD.iface) as string | undefined,
      member: field(FIELD.member) as string | undefined,
      sender: field(FIELD.sender) as string | undefined,
      errorName: field(FIELD.errorName) as string | undefined,
      body
    }
  };
};

// --- connection -------------------------------------------------------------------------------

const busPath = () => {
  const address = process.env.DBUS_SESSION_BUS_ADDRESS ?? '';
  for (const part of address.split(';')) {
    const [transport, params = ''] = part.split(':');
    if (transport !== 'unix') continue;
    const kv = Object.fromEntries(params.split(',').map((p) => p.split('=')));
    if (kv.path) return { path: decodeURIComponent(kv.path) };
    if (kv.abstract) return { path: '\0' + decodeURIComponent(kv.abstract) };
  }
  return null;
};

class Bus {
  private socket!: Socket;
  private buf = Buffer.alloc(0);
  private serial = 0;
  private pending = new Map<number, { resolve: (m: TMessage) => void; reject: (e: Error) => void }>();
  private signalHandlers = new Set<(m: TMessage) => void>();
  name = '';

  async open() {
    const target = busPath();
    if (!target) throw new Error('no session bus');

    this.socket = createConnection(target.path);
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });

    // EXTERNAL auth with our uid, then the binary protocol
    const uid = Buffer.from(String(process.getuid?.() ?? 0)).toString('hex');
    this.socket.write(`\0AUTH EXTERNAL ${uid}\r\n`);
    const reply = await new Promise<string>((resolve, reject) => {
      this.socket.once('data', (d) => resolve(d.toString('ascii')));
      this.socket.once('error', reject);
    });
    if (!reply.startsWith('OK')) throw new Error(`dbus auth: ${reply.trim()}`);
    this.socket.write('BEGIN\r\n');

    this.socket.on('data', (d) => this.onData(d));
    this.socket.on('error', (err) => this.failAll(err));
    this.socket.on('close', () => this.failAll(new Error('dbus connection closed')));

    const hello = await this.call({ path: '/org/freedesktop/DBus', iface: 'org.freedesktop.DBus', member: 'Hello', destination: 'org.freedesktop.DBus' });
    this.name = hello.body[0] as string;
  }

  private failAll(err: Error) {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const next = decode(this.buf);
      if (!next) return;
      this.buf = this.buf.subarray(next.size);
      const m = next.message;

      if ((m.type === 2 || m.type === 3) && m.replySerial !== undefined) {
        const p = this.pending.get(m.replySerial);
        this.pending.delete(m.replySerial);
        if (m.type === 3) p?.reject(new Error(`${m.errorName}: ${m.body[0] ?? ''}`));
        else p?.resolve(m);
      } else if (m.type === 4) {
        this.signalHandlers.forEach((h) => h(m));
      }
    }
  }

  call(m: { path: string; iface: string; member: string; destination: string; sig?: string; body?: TValue[] }) {
    const serial = ++this.serial;
    return new Promise<TMessage>((resolve, reject) => {
      this.pending.set(serial, { resolve, reject });
      this.socket.write(encode(serial, m));
    });
  }

  onSignal(h: (m: TMessage) => void) {
    this.signalHandlers.add(h);
    return () => this.signalHandlers.delete(h);
  }

  close() {
    this.socket?.destroy();
  }
}

// --- the background portal --------------------------------------------------------------------

const PORTAL = { destination: 'org.freedesktop.portal.Desktop', path: '/org/freedesktop/portal/desktop' };

/**
 * Asks the portal to (not) start the app at login. Resolves with what the portal granted; the
 * desktop may ask the user first, so this can take a while.
 */
export const requestAutostart = async (enabled: boolean, commandline: string[]): Promise<boolean> => {
  const bus = new Bus();

  try {
    await bus.open();

    const token = `jollyboat${Date.now()}`;
    const handle = `/org/freedesktop/portal/desktop/request/${bus.name.slice(1).replace(/\./g, '_')}/${token}`;

    const response = new Promise<TMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer from the portal')), 120_000);
      bus.onSignal((m) => {
        if (m.path === handle && m.member === 'Response') {
          clearTimeout(timer);
          resolve(m);
        }
      });
    });

    await bus.call({
      path: '/org/freedesktop/DBus',
      iface: 'org.freedesktop.DBus',
      member: 'AddMatch',
      destination: 'org.freedesktop.DBus',
      sig: 's',
      body: [`type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${handle}'`]
    });

    const options = new Map<string, TValue>([
      ['handle_token', variant('s', token)],
      ['reason', variant('s', 'Start Jollyboat in the tray when you log in')],
      ['autostart', variant('b', enabled)],
      ['commandline', variant('as', commandline)],
      ['dbus-activatable', variant('b', false)]
    ]);

    await bus.call({ ...PORTAL, iface: 'org.freedesktop.portal.Background', member: 'RequestBackground', sig: 'sa{sv}', body: ['', options] });

    const answer = await response;
    const code = answer.body[0] as number;
    const results = answer.body[1] as Map<string, TValue>;
    const granted = (results.get('autostart') as TVariant | undefined)?.value === true;

    log('portal', `background: response ${code}, autostart ${granted}`);
    return code === 0 && granted;
  } finally {
    bus.close();
  }
};
