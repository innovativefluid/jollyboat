import { app, session } from 'electron';

// Spellcheck dictionaries (windows and linux) come from google's cdn. Electron loads one for the
// system locale while the profile is created — before any app code can reach the session — and
// refills an empty language list with that locale. So with spellcheck off the host is made
// unresolvable on the command line, which is in place before the network stack starts: no dns
// query, no connection. Runtime toggling also clears the language list and points the download
// url at a closed local port; turning spellcheck on needs a restart to lift the resolver rule.

const SPELLCHECK_DICTIONARY_URL = 'https://redirector.gvt1.com/edgedl/chrome/dict/';
const DICTIONARY_HOST = 'redirector.gvt1.com';
const NOWHERE = 'http://127.0.0.1:9/';

/** call before app ready */
export const blockDictionaryDownloads = () => {
  app.commandLine.appendSwitch('host-resolver-rules', `MAP ${DICTIONARY_HOST} ~NOTFOUND`);
};

export const applySpellcheck = (enabled: boolean) => {
  const ses = session.defaultSession;

  if (enabled) {
    const available = new Set(ses.availableSpellCheckerLanguages);
    const wanted = app.getPreferredSystemLanguages().filter((l) => available.has(l));

    ses.setSpellCheckerDictionaryDownloadURL(SPELLCHECK_DICTIONARY_URL);
    ses.setSpellCheckerLanguages(wanted.length ? wanted : available.has('en-US') ? ['en-US'] : []);
    ses.setSpellCheckerEnabled(true);
    return;
  }

  ses.setSpellCheckerDictionaryDownloadURL(NOWHERE);
  ses.setSpellCheckerLanguages([]);
  ses.setSpellCheckerEnabled(false);
};
