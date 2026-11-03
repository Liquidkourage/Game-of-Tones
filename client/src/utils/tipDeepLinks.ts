/**
 * Build amount-aware tip deep links from a host-saved profile URL + selected cents.
 * Cash App / PayPal.me are reliable; Venmo is best-effort (unofficial pay URLs).
 */

function dollarsFromCents(cents: number): string {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n < 100) return '1.00';
  return (n / 100).toFixed(2);
}

function dollarsPathFromCents(cents: number): string {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n < 100) return '1';
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2);
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(String(raw || '').trim());
  } catch {
    return null;
  }
}

function firstPathSegment(pathname: string): string {
  return String(pathname || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
}

/** Extract Venmo username from common profile / pay URL shapes. */
export function extractVenmoUsername(saved: string): string | null {
  const t = String(saved || '').trim();
  if (!t) return null;
  if (/^@?[A-Za-z0-9_-]{3,30}$/.test(t)) return t.replace(/^@/, '');

  const u = safeUrl(t);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (!host.includes('venmo.com')) return null;

  const recip = u.searchParams.get('recipients');
  if (recip) {
    const cleaned = recip
      .split(',')
      .map((s) => s.trim().replace(/^@/, '').replace(/^%2C/i, ''))
      .find((s) => /^[A-Za-z0-9_-]{3,30}$/.test(s));
    if (cleaned) return cleaned;
  }

  const parts = u.pathname.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts[0]?.toLowerCase() === 'u' && parts[1]) {
    return parts[1].replace(/^@/, '');
  }
  if (parts[0] && !/^(pay|account|business)$/i.test(parts[0])) {
    return parts[0].replace(/^@/, '');
  }
  return null;
}

/** Extract Cash App $cashtag (with leading $). */
export function extractCashAppTag(saved: string): string | null {
  const t = String(saved || '').trim();
  if (!t) return null;
  if (/^\$?[A-Za-z0-9_]{1,20}$/.test(t)) {
    return t.startsWith('$') ? t : `$${t}`;
  }
  const u = safeUrl(t);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'cash.app' && host !== 'cash.me') return null;
  const seg = firstPathSegment(u.pathname);
  if (!seg) return null;
  const tag = seg.startsWith('$') ? seg : `$${seg}`;
  return /^\$[A-Za-z0-9_]{1,20}$/.test(tag) ? tag : null;
}

/** Extract PayPal.me username. */
export function extractPaypalMeUsername(saved: string): string | null {
  const t = String(saved || '').trim();
  if (!t) return null;
  if (/^@?[A-Za-z0-9._-]{3,30}$/.test(t)) return t.replace(/^@/, '');

  const u = safeUrl(t);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  const parts = u.pathname.split('/').map((s) => s.trim()).filter(Boolean);

  if (host === 'paypal.me' || host.endsWith('.paypal.me')) {
    return parts[0]?.replace(/^@/, '') || null;
  }
  if (host.includes('paypal.com')) {
    const idx = parts.findIndex((p) => /^paypalme$/i.test(p));
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].replace(/^@/, '');
  }
  return null;
}

/**
 * Venmo payment link for amount + note.
 * As of late 2024+, Venmo often ignores `recipients` for the To field even when
 * it appears in the redirected account.venmo.com/pay URL — copy @handle instead.
 */
export function buildVenmoTipUrl(
  saved: string,
  amountCents: number,
  note = 'Tempo tip',
): string {
  const amount = dollarsFromCents(amountCents);
  const tipNote = String(note || 'Tempo tip').trim().slice(0, 80) || 'Tempo tip';
  const username = extractVenmoUsername(saved);
  if (username) {
    const params = new URLSearchParams({
      txn: 'pay',
      amount,
      note: tipNote,
      // Keep recipients for clients that still honor it; UI may still leave To blank.
      recipients: `@${username}`,
    });
    return `https://venmo.com/?${params.toString()}`;
  }
  // Fall back to saved URL with amount query if we couldn't parse a handle.
  const u = safeUrl(saved);
  if (u) {
    u.searchParams.set('txn', 'pay');
    u.searchParams.set('amount', amount);
    u.searchParams.set('note', tipNote);
    return u.href;
  }
  return saved;
}

/** Copy "@username" for Venmo's To field (clipboard is the reliable path now). */
export async function copyVenmoHandle(saved: string | undefined): Promise<string | null> {
  const raw = String(saved || '').trim();
  if (!raw) return null;
  const username = extractVenmoUsername(raw);
  if (!username || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return username ? `@${username}` : null;
  }
  const handle = `@${username}`;
  try {
    await navigator.clipboard.writeText(handle);
    return handle;
  } catch {
    return handle;
  }
}

export function buildCashAppTipUrl(saved: string, amountCents: number): string {
  const tag = extractCashAppTag(saved);
  if (!tag) return saved;
  return `https://cash.app/${tag}/${dollarsFromCents(amountCents)}`;
}

export function buildPaypalMeTipUrl(saved: string, amountCents: number): string {
  const user = extractPaypalMeUsername(saved);
  if (!user) return saved;
  return `https://paypal.me/${user}/${dollarsPathFromCents(amountCents)}`;
}

export function tipRailHref(
  rail: 'venmo' | 'cashapp' | 'paypal' | 'other',
  saved: string | undefined,
  amountCents: number,
  note?: string,
): string | null {
  const raw = String(saved || '').trim();
  if (!raw) return null;
  if (rail === 'venmo') return buildVenmoTipUrl(raw, amountCents, note);
  if (rail === 'cashapp') return buildCashAppTipUrl(raw, amountCents);
  if (rail === 'paypal') return buildPaypalMeTipUrl(raw, amountCents);
  return raw;
}

/**
 * Copy @handle (for To), then open Venmo with amount + note prefilled.
 * Returns the handle string when clipboard write was attempted.
 */
export async function openVenmoTip(
  saved: string | undefined,
  amountCents: number,
  note?: string,
): Promise<{ handle: string | null; href: string }> {
  const raw = String(saved || '').trim();
  const href = raw ? buildVenmoTipUrl(raw, amountCents, note) : '';
  const handle = await copyVenmoHandle(saved);
  if (href && typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
  return { handle, href };
}
