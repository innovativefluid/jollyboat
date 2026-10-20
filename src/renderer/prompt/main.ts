// a yes/no question in the app's own look, for the places a native dialog would have been

import { bootTheme } from '../theme/ui';

bootTheme();

const q = new URLSearchParams(location.search);
const yes = document.getElementById('yes') as HTMLButtonElement;
const no = document.getElementById('no') as HTMLButtonElement;

document.getElementById('message')!.textContent = q.get('message') ?? '';
document.getElementById('detail')!.textContent = q.get('detail') ?? '';
yes.textContent = q.get('yes') ?? 'yes';
no.textContent = q.get('no') ?? 'no';

yes.onclick = () => window.shell.promptAnswer(true);
no.onclick = () => window.shell.promptAnswer(false);
no.focus();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.shell.promptAnswer(false);
  if (e.key === 'Enter' && document.activeElement !== yes) { e.preventDefault(); window.shell.promptAnswer(false); }
});
