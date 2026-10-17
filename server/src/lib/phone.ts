/**
 * Bangladeshi mobile numbers: 01[3-9]XXXXXXXX (11 digits).
 * Accepts +8801…, 8801…, 01…, with spaces / dashes, and Bengali digits.
 */
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeBdPhone(input: string): string | null {
  if (!input) return null;
  let s = input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("880")) s = s.slice(2);
  else if (s.startsWith("88") && s.length === 13) s = s.slice(2);
  if (/^1[3-9]\d{8}$/.test(s)) s = `0${s}`;
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

export const isValidBdPhone = (input: string) => normalizeBdPhone(input) !== null;

/** E.164 form for SMS / WhatsApp providers. */
export const toE164 = (phone: string) => `+88${phone}`;
