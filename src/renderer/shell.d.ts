import type {
  TBridgeStatus,
  TUpdateStatus,
  TCaptureSource,
  TPickerResult,
  TServerEntry,
  TServerInput,
  TSettings,
  TTestResult,
  TOverlayState
} from '../shared/types';

declare global {
  interface Window {
    shell: {
      platform: string;
      version: string;
      storeUpdates: boolean;
      wayland: boolean;
      lang: 'en' | 'de' | 'pl';
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
      shareCode: (ids: string[] | null, withPasswords: boolean) => Promise<string>;
      exportFile: (ids: string[] | null, withPasswords: boolean) => Promise<string | null>;
      importText: (text: string) => Promise<string[]>;
      importFile: () => Promise<string[] | null>;
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
