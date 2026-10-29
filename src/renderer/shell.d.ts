import type {
  TBridgeStatus,
  TUpdateStatus,
  TCaptureSource,
  TPickerResult,
  TServerEntry,
  TServerInput,
  TSettings,
  TTestResult,
  TOverlayState,
  TImported
} from '../shared/types';


declare global {
  interface Window {
    shell: {
      platform: string;
      version: string;
      storeUpdates: boolean;
      wayland: boolean;
      lang: 'en' | 'de' | 'pl';
      /** the lcd look or the water look, as the page started; onLook for changes */
      look: 'lcd' | 'water' | 'retro';
      onLook: (cb: (look: 'lcd' | 'water' | 'retro') => void) => void;
      getSettings: () => Promise<TSettings & { secureStorage: boolean; spellcheckAtStart: boolean }>;
      saveSettings: (patch: Partial<TSettings>) => Promise<TSettings>;
      listServers: () => Promise<TServerEntry[]>;
      saveServer: (input: TServerInput) => Promise<{ server: TServerEntry; test: TTestResult }>;
      removeServer: (id: string) => Promise<void>;
      setKeepLogin: (id: string, keep: boolean) => Promise<void>;
      connect: (id: string) => Promise<void>;
      bridgeStatus: () => Promise<TBridgeStatus>;
      screenAudioInfo: () => Promise<{ ok: boolean; text: string }>;
      openWebsite: () => Promise<void>;
      shareCode: (ids: string[] | null, withPasswords: boolean, invite?: string) => Promise<string>;
      exportFile: (ids: string[] | null, withPasswords: boolean) => Promise<string | null>;
      importText: (text: string) => Promise<TImported>;
      importFile: () => Promise<TImported | null>;
      getAutoStart: () => Promise<{ supported: boolean; enabled: boolean }>;
      setAutoStart: (enabled: boolean) => Promise<boolean>;
      updateStatus: () => Promise<TUpdateStatus>;
      installUpdate: () => Promise<void>;
      openReleasePage: () => Promise<void>;
      diagnostics: () => Promise<string>;
      onUpdateStatus: (cb: (s: TUpdateStatus) => void) => void;
      onPickerSources: (cb: (sources: TCaptureSource[], lastName: string | null) => void) => void;
      promptAnswer: (answer: boolean) => void;
      barAction: (action: 'settings' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'menu' | 'minimize' | 'maximize' | 'close' | 'popout', at?: { x: number; y: number }) => void;
      /** the server window's focus (the bar never holds the keyboard itself for long) */
      windowFocused: () => boolean;
      onBarState: (cb: (state: { server: string; zoom: number; theme: 'light' | 'dark' | null; maximized: boolean; streams: number }) => void) => void;
      pickerChoose: (result: TPickerResult) => void;
      onOverlayState: (cb: (state: TOverlayState) => void) => void;
      overlayHeight: (h: number) => void;
      editCustomCss: () => Promise<string>;
      useCssExample: () => Promise<void>;
      overlayDone: () => void;
      positionOverlay: () => Promise<void>;
    };
  }
}

export {};
