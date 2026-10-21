// Where global key presses come from. Sharkord's push-to-talk needs the release as well as the
// press, which Electron's globalShortcut cannot report, so each platform gets the best source:
//
//  Windows  a low-level keyboard hook (uiohook-napi): press and release, keys still reach the
//           focused app (as with any push-to-talk)
//  Linux    the desktop's GlobalShortcuts portal (KDE Plasma, GNOME 48+, also on Wayland):
//           Activated / Deactivated; the desktop asks the user once and keeps the keys in its
//           own shortcut settings
//  else     Electron's globalShortcut: presses only, so Sharkord turns push-to-talk off
//
// A source gets the full list of combos every time and answers which of them failed.

import { app, globalShortcut } from 'electron';
import { createRequire } from 'node:module';
import { log } from '../log';
import { Bus, result, variant, type TMessage, type TValue } from '../portal';
import { codeToHookName, comboToAccelerator, comboToPortalTrigger, isModifierCode, parseCombo, type TMods } from './combo';

type TPhase = 'down' | 'up';
type TKeyBinding = { combo: string; description: string };

export type TKeySource = {
  name: string;
  keyUp: boolean;
  /** replaces every binding; resolves with combo → reason for the ones that did not register */
  apply: (bindings: TKeyBinding[]) => Promise<Map<string, string>>;
  stop: () => void;
};

type TEmit = (combo: string, phase: TPhase) => void;

// --- electron globalShortcut (presses only) --------------------------------------------------

const electronSource = (emit: TEmit): TKeySource => ({
  name: 'globalShortcut',
  keyUp: false,
  apply: async (bindings) => {
    globalShortcut.unregisterAll();
    const failed = new Map<string, string>();
    const byAccelerator = new Map<string, Set<string>>();

    for (const { combo } of bindings) {
      const parsed = comboToAccelerator(combo);
      if ('error' in parsed) {
        failed.set(combo, parsed.error);
        continue;
      }
      const set = byAccelerator.get(parsed.accelerator) ?? new Set<string>();
      set.add(combo);
      byAccelerator.set(parsed.accelerator, set);
    }

    for (const [accelerator, combos] of byAccelerator) {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => combos.forEach((c) => emit(c, 'down')));
      } catch {
        ok = false;
      }
      if (!ok) combos.forEach((c) => failed.set(c, 'the system refused this key'));
    }

    return failed;
  },
  stop: () => globalShortcut.unregisterAll()
});

// --- keyboard hook (windows) ------------------------------------------------------------------

type THookEvent = { keycode: number; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean };
type THook = {
  uIOhook: { on: (e: 'keydown' | 'keyup', cb: (ev: THookEvent) => void) => void; start: () => void; stop: () => void };
  UiohookKey: Record<string, number>;
};

const hookSource = (emit: TEmit): TKeySource | null => {
  let hook: THook;
  try {
    hook = createRequire(import.meta.url)('uiohook-napi') as THook;
  } catch (err) {
    log('hotkeys', 'keyboard hook unavailable:', (err as Error).message);
    return null;
  }

  type TWatch = { combo: string; keycode: number; mods: TMods; modifierOnly: boolean };
  let watches: TWatch[] = [];
  const held = new Set<string>();
  let running = false;

  const flags = (ev: THookEvent): TMods => ({ ctrl: ev.ctrlKey, alt: ev.altKey, shift: ev.shiftKey, meta: ev.metaKey });
  // exact modifiers; a lone modifier (shift as push-to-talk, say) only counts without the
  // other modifiers, so ctrl+shift+m does not also trigger it
  const modsMatch = (w: TWatch, ev: THookEvent) => {
    const now = flags(ev);
    if (w.modifierOnly) {
      const own = modOf(w.keycode);
      return (['ctrl', 'alt', 'shift', 'meta'] as const).every((m) => m === own || !now[m]);
    }
    return w.mods.ctrl === now.ctrl && w.mods.alt === now.alt && w.mods.shift === now.shift && w.mods.meta === now.meta;
  };

  // the hook's modifier flags: which keycodes count as which modifier
  const modOf = (keycode: number): keyof TMods | null => {
    const k = hook.UiohookKey;
    if (keycode === k.Ctrl || keycode === k.CtrlRight) return 'ctrl';
    if (keycode === k.Alt || keycode === k.AltRight) return 'alt';
    if (keycode === k.Shift || keycode === k.ShiftRight) return 'shift';
    if (keycode === k.Meta || keycode === k.MetaRight) return 'meta';
    return null;
  };

  hook.uIOhook.on('keydown', (ev) => {
    for (const w of watches) {
      // key repeat sends more downs while held; one is enough
      if (ev.keycode === w.keycode && !held.has(w.combo) && modsMatch(w, ev)) {
        held.add(w.combo);
        emit(w.combo, 'down');
      }
    }
  });

  hook.uIOhook.on('keyup', (ev) => {
    const mod = modOf(ev.keycode);
    for (const w of watches) {
      if (!held.has(w.combo)) continue;
      // released: the key itself, or one of the modifiers the combo needs
      if (ev.keycode === w.keycode || (mod && !w.modifierOnly && w.mods[mod])) {
        held.delete(w.combo);
        emit(w.combo, 'up');
      }
    }
  });

  return {
    name: 'keyboard hook',
    keyUp: true,
    apply: async (bindings) => {
      const failed = new Map<string, string>();
      // anything held when the list changes is let go first, so no mic stays open
      for (const combo of held) emit(combo, 'up');
      held.clear();

      watches = bindings.flatMap(({ combo }) => {
        const parsed = parseCombo(combo);
        if ('error' in parsed) {
          failed.set(combo, parsed.error);
          return [];
        }
        const name = codeToHookName(parsed.key);
        const keycode = name === undefined ? undefined : hook.UiohookKey[name];
        if (keycode === undefined) {
          failed.set(combo, `unsupported key ${parsed.key}`);
          return [];
        }
        return [{ combo, keycode, mods: parsed.mods, modifierOnly: isModifierCode(parsed.key) }];
      });

      if (watches.length && !running) {
        hook.uIOhook.start();
        running = true;
      } else if (!watches.length && running) {
        hook.uIOhook.stop();
        running = false;
      }

      return failed;
    },
    stop: () => {
      if (running) hook.uIOhook.stop();
      running = false;
    }
  };
};

// --- GlobalShortcuts portal (linux) -----------------------------------------------------------

const GS = 'org.freedesktop.portal.GlobalShortcuts';

/** a stable shortcut id per key combo: the desktop remembers the user's choice under it */
const shortcutId = (combo: string) => `jb-${combo.replace(/[^A-Za-z0-9]+/g, '-')}`;

const portalSource = async (emit: TEmit): Promise<TKeySource | null> => {
  const bus = new Bus();

  try {
    await bus.open();
    const version = await bus.call({
      destination: 'org.freedesktop.portal.Desktop',
      path: '/org/freedesktop/portal/desktop',
      iface: 'org.freedesktop.DBus.Properties',
      member: 'Get',
      sig: 'ss',
      body: [GS, 'version']
    });
    log('hotkeys', `GlobalShortcuts portal version ${(version.body[0] as { value: TValue })?.value}`);
    await bus.addMatch(`type='signal',interface='org.freedesktop.portal.Request',member='Response'`);
    await bus.addMatch(`type='signal',interface='${GS}'`);
  } catch (err) {
    log('hotkeys', 'GlobalShortcuts portal unavailable:', (err as Error).message);
    bus.close();
    return null;
  }

  let session = '';
  let combosById = new Map<string, string>();
  const held = new Set<string>();

  const releaseAll = () => {
    for (const id of held) {
      const combo = combosById.get(id);
      if (combo) emit(combo, 'up');
    }
    held.clear();
  };

  bus.onSignal((m: TMessage) => {
    if (m.iface !== GS || m.body[0] !== session) return;
    const combo = combosById.get(m.body[1] as string);
    if (!combo) return;
    if (m.member === 'Activated' && !held.has(combo)) {
      held.add(combo);
      emit(combo, 'down');
    } else if (m.member === 'Deactivated' && held.delete(combo)) {
      emit(combo, 'up');
    }
  });
  bus.onClose = () => {
    log('hotkeys', 'portal connection lost');
    releaseAll();
    session = '';
  };

  const closeSession = async () => {
    if (!session) return;
    const old = session;
    session = '';
    await bus.call({ destination: 'org.freedesktop.portal.Desktop', path: old, iface: 'org.freedesktop.portal.Session', member: 'Close' }).catch(() => undefined);
  };

  // one apply at a time: a second waits for the first (the desktop may show a dialog)
  let queue = Promise.resolve(new Map<string, string>());

  const applyNow = async (bindings: TKeyBinding[]) => {
    const failed = new Map<string, string>();
    releaseAll();

    const entries: [string, Map<string, TValue>][] = [];
    const nextIds = new Map<string, string>();
    const seen = new Set<string>();

    for (const { combo, description } of bindings) {
      if (seen.has(combo)) continue;
      seen.add(combo);
      const parsed = comboToPortalTrigger(combo);
      if ('error' in parsed) {
        failed.set(combo, parsed.error);
        continue;
      }
      const id = shortcutId(combo);
      nextIds.set(id, combo);
      entries.push([id, new Map<string, TValue>([['description', variant('s', description)], ['preferred_trigger', variant('s', parsed.trigger)]])]);
    }

    // the shortcut list of a session is fixed once bound: a new list gets a new session
    await closeSession();
    combosById = nextIds;
    if (!entries.length) return failed;

    const created = await bus.request(GS, 'CreateSession', 'a{sv}', [new Map<string, TValue>([['session_handle_token', variant('s', `jollyboat${Date.now() % 100000}`)]])]);
    const handle = result(created.results, 'session_handle');
    if (created.code !== 0 || typeof handle !== 'string') {
      bindings.forEach(({ combo }) => failed.has(combo) || failed.set(combo, 'the desktop refused global shortcuts'));
      return failed;
    }
    session = handle;

    const bound = await bus.request(GS, 'BindShortcuts', 'oa(sa{sv})sa{sv}', [session, entries as unknown as TValue[], '', new Map<string, TValue>()], 300_000);
    if (bound.code !== 0) {
      bindings.forEach(({ combo }) => failed.has(combo) || failed.set(combo, 'not allowed in the desktop dialog'));
      return failed;
    }

    const accepted = new Set(((result(bound.results, 'shortcuts') as [string, unknown][] | undefined) ?? []).map(([id]) => id));
    for (const [id, combo] of nextIds) {
      if (!accepted.has(id)) failed.set(combo, 'no key assigned in the desktop shortcut settings');
    }
    log('hotkeys', `portal bound ${accepted.size} of ${nextIds.size}`);
    return failed;
  };

  return {
    name: 'GlobalShortcuts portal',
    keyUp: true,
    apply: (bindings) => {
      queue = queue.catch(() => new Map()).then(() =>
        applyNow(bindings).catch((err) => {
          log('hotkeys', 'portal bind failed:', (err as Error).message);
          return new Map(bindings.map(({ combo }) => [combo, 'the desktop shortcut service did not answer']));
        })
      );
      return queue;
    },
    stop: () => {
      releaseAll();
      void closeSession().finally(() => bus.close());
    }
  };
};

// ---------------------------------------------------------------------------------------------

/** the best key source this system offers */
export const createKeySource = async (emit: TEmit): Promise<TKeySource> => {
  const forced = process.env.JOLLYBOAT_KEYS; // dev: 'hook' | 'portal' | 'electron'
  let source: TKeySource | null = null;

  if (forced !== 'electron') {
    if ((process.platform === 'win32' && !forced) || forced === 'hook') source = hookSource(emit);
    else if ((process.platform === 'linux' && !forced) || forced === 'portal') source = await portalSource(emit);
  }

  source ??= electronSource(emit);
  log('hotkeys', `key source: ${source.name}${source.keyUp ? ' (press and release)' : ' (presses only)'}`);
  app.once('will-quit', () => source?.stop());
  return source;
};
