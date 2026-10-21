// Sharkord sends combos as `ctrl+alt+shift+meta+<KeyboardEvent.code>` (modifiers lowercase,
// any subset, in any order). Electron's globalShortcut wants an accelerator string.

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

type TParsedCombo = { accelerator: string } | { error: string };

export const comboToAccelerator = (combo: string): TParsedCombo => {
  const parts = combo.split('+');
  const mods: string[] = [];
  let key: string | undefined;

  for (const part of parts) {
    if (part === 'ctrl') mods.push('Control');
    else if (part === 'alt') mods.push('Alt');
    else if (part === 'shift') mods.push('Shift');
    else if (part === 'meta') mods.push('Super');
    else if (part === '') return { error: 'invalid combo' };
    else if (key !== undefined) return { error: 'invalid combo' };
    else key = part;
  }

  if (!key) return { error: 'no key' };

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
