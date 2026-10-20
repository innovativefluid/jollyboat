import type {
  TBridgeStatus,
  TUpdateStatus,
  TCaptureSource,
  TPickerResult,
  TServerEntry,
  TServerInput,
  TSettings,
  TTestResult
} from '../shared/types';

declare global {
  interface Window {
    shell: {
      platform: string;
      version: string;
      getSettings: () => Promise<TSettings & { secureStorage: boolean; spellcheckAtStart: boolean }>;
      saveSettings: (patch: Partial<TSettings>) => Promise<TSettings>;
      listServers: () => Promise<TServerEntry[]>;
      saveServer: (input: TServerInput) => Promise<{ server: TServerEntry; test: TTestResult }>;
      removeServer: (id: string) => Promise<void>;
      testServer: (input: TServerInput) => Promise<TTestResult>;
      connect: (id: string) => Promise<void>;
      bridgeStatus: () => Promise<TBridgeStatus>;
      screenAudioInfo: () => Promise<{ ok: boolean; text: string }>;
      quit: () => Promise<void>;
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
      pickerChoose: (result: TPickerResult) => void;
    };
  }
}

export {};
