// A small in-memory log for diagnostics: the last few hundred lines from the main process and
// the `[jollyboat]` warnings the page side reports. JOLLYBOAT_DEBUG=1 also prints them.

const MAX = 300;
const lines: string[] = [];

export const log = (tag: string, ...parts: unknown[]) => {
  const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const line = `${new Date().toISOString().slice(11, 23)} [${tag}] ${text}`;

  lines.push(line);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  if (process.env.JOLLYBOAT_DEBUG) console.log(line);
};

export const recentLog = (n = 120) => lines.slice(-n);
