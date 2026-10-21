// Sharkord sends combos as `ctrl+alt+shift+meta+<KeyboardEvent.code>` (modifiers lowercase,
// any subset, in any order). Each key source wants its own form: Electron's globalShortcut an
// accelerator string, the keyboard hook (windows) a scan code plus modifier flags, the
// GlobalShortcuts portal (linux) an XDG trigger like `CTRL+SHIFT+m`.

const CODE_MAP: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  AudioVolumeMute: 'VolumeMute',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  MediaPlayPause: 'MediaPlayPause',
  MediaStop: 'MediaStop',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack'
};

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'
]);

export type TMods = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };
type TCombo = { mods: TMods; key: string } | { error: string };

export const parseCombo = (combo: string): TCombo => {
  const mods: TMods = { ctrl: false, alt: false, shift: false, meta: false };
  let key: string | undefined;

  for (const part of combo.split('+')) {
    if (part === 'ctrl' || part === 'alt' || part === 'shift' || part === 'meta') mods[part] = true;
    else if (part === '') return { error: 'invalid combo' };
    else if (key !== undefined) return { error: 'invalid combo' };
    else key = part;
  }

  if (!key) return { error: 'no key' };
  return { mods, key };
};

export const isModifierCode = (code: string) => MODIFIER_CODES.has(code);

export const comboToAccelerator = (combo: string): { accelerator: string } | { error: string } => {
  const parsed = parseCombo(combo);
  if ('error' in parsed) return parsed;

  const { key } = parsed;
  const mods = [
    ...(parsed.mods.ctrl ? ['Control'] : []),
    ...(parsed.mods.alt ? ['Alt'] : []),
    ...(parsed.mods.shift ? ['Shift'] : []),
    ...(parsed.mods.meta ? ['Super'] : [])
  ];

  if (MODIFIER_CODES.has(key)) {
    return { error: 'a modifier alone cannot be a global hotkey in this client' };
  }

  let mapped: string | undefined;

  if (/^Key[A-Z]$/.test(key)) mapped = key.slice(3);
  else if (/^Digit[0-9]$/.test(key)) mapped = key.slice(5);
  else if (/^Numpad[0-9]$/.test(key)) mapped = `num${key.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) mapped = key;
  else mapped = CODE_MAP[key];

  if (!mapped) return { error: `unsupported key ${key}` };

  return { accelerator: [...mods, mapped].join('+') };
};

// --- keyboard hook (uiohook scan codes) -------------------------------------------------------

const HOOK_NAMES: Record<string, string> = {
  Enter: 'Enter', NumpadEnter: 'NumpadEnter', Escape: 'Escape', Tab: 'Tab', Space: 'Space',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', CapsLock: 'CapsLock', NumLock: 'NumLock',
  ScrollLock: 'ScrollLock', PrintScreen: 'PrintScreen', NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract', NumpadMultiply: 'NumpadMultiply', NumpadDivide: 'NumpadDivide',
  NumpadDecimal: 'NumpadDecimal', Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight', Semicolon: 'Semicolon', Quote: 'Quote', Backquote: 'Backquote',
  Backslash: 'Backslash', Comma: 'Comma', Period: 'Period', Slash: 'Slash',
  ControlLeft: 'Ctrl', ControlRight: 'CtrlRight', AltLeft: 'Alt', AltRight: 'AltRight',
  ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', MetaLeft: 'Meta', MetaRight: 'MetaRight'
};

/** the hook's name for a KeyboardEvent.code (look it up in UiohookKey) */
export const codeToHookName = (code: string): string | undefined => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return HOOK_NAMES[code];
};

// --- GlobalShortcuts portal (XDG shortcuts spec: modifiers + xkb keysym name) -----------------

const KEYSYMS: Record<string, string> = {
  Space: 'space', Enter: 'Return', NumpadEnter: 'KP_Enter', Escape: 'Escape', Tab: 'Tab',
  Backspace: 'BackSpace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'Page_Up', PageDown: 'Page_Down', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left',
  ArrowRight: 'Right', CapsLock: 'Caps_Lock', NumLock: 'Num_Lock', ScrollLock: 'Scroll_Lock',
  PrintScreen: 'Print', NumpadAdd: 'KP_Add', NumpadSubtract: 'KP_Subtract',
  NumpadMultiply: 'KP_Multiply', NumpadDivide: 'KP_Divide', NumpadDecimal: 'KP_Decimal',
  Minus: 'minus', Equal: 'equal', BracketLeft: 'bracketleft', BracketRight: 'bracketright',
  Semicolon: 'semicolon', Quote: 'apostrophe', Backquote: 'grave', Backslash: 'backslash',
  Comma: 'comma', Period: 'period', Slash: 'slash', AudioVolumeMute: 'XF86AudioMute',
  AudioVolumeUp: 'XF86AudioRaiseVolume', AudioVolumeDown: 'XF86AudioLowerVolume',
  MediaPlayPause: 'XF86AudioPlay', MediaStop: 'XF86AudioStop', MediaTrackNext: 'XF86AudioNext',
  MediaTrackPrevious: 'XF86AudioPrev'
};

export const comboToPortalTrigger = (combo: string): { trigger: string } | { error: string } => {
  const parsed = parseCombo(combo);
  if ('error' in parsed) return parsed;

  const { key, mods } = parsed;
  if (MODIFIER_CODES.has(key)) return { error: 'a modifier alone cannot be a desktop shortcut' };

  let sym: string | undefined;
  if (/^Key[A-Z]$/.test(key)) sym = key.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(key)) sym = key.slice(5);
  else if (/^Numpad[0-9]$/.test(key)) sym = `KP_${key.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) sym = key;
  else sym = KEYSYMS[key];

  if (!sym) return { error: `unsupported key ${key}` };

  const parts = [...(mods.ctrl ? ['CTRL'] : []), ...(mods.alt ? ['ALT'] : []), ...(mods.shift ? ['SHIFT'] : []), ...(mods.meta ? ['LOGO'] : []), sym];
  return { trigger: parts.join('+') };
};
