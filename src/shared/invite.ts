// Sharkord invites: a server owner makes one in the server settings and passes on its link,
// https://chat.example.com/?invite=CODE. Sharkord's connect screen reads ?invite from the page's
// own address, so the app keeps the code on the server entry and opens the page with it.

/** what Sharkord accepts as an invite code (its INVITE_CODE_REGEX, with its length limits) */
export const INVITE_CODE = /^[A-Za-z0-9_-]{4,64}$/;

/** an invite link (the server's origin and the code), or with `bareCode` also just a code */
export const parseInvite = (text: string, bareCode = false): { url?: string; code: string } | null => {
  const s = text.trim();
  if (bareCode && INVITE_CODE.test(s)) return { code: s };
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const code = u.searchParams.get('invite');
    if (code && INVITE_CODE.test(code)) return { url: u.origin, code };
  } catch {
    /* not a url */
  }
  return null;
};
