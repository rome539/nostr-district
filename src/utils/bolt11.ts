// Amount extraction for BOLT11 invoices.
//
// An LNURL server picks the invoice, and nothing forces it to honour the amount
// we asked for — so an invoice must be checked against the price the user was
// shown before anything pays it. We only need the amount, which lives in the
// human-readable prefix, so this parses that rather than pulling in a full
// bech32 decoder.
//
// HRP grammar (BOLT11): `ln` + currency (bc/tb/bcrt/sb) + optional amount,
// where the amount is digits plus an optional multiplier.

const MULTIPLIERS: Record<string, number> = {
  m: 100_000_000,  // milli  → 1e-3 BTC
  u: 100_000,      // micro  → 1e-6 BTC
  n: 100,          // nano   → 1e-9 BTC
  p: 0.1,          // pico   → 1e-12 BTC (must land on a whole msat)
};
const BTC_IN_MSAT = 100_000_000_000;

/**
 * Millisatoshis an invoice demands, or null if it has no amount (a "donation"
 * invoice the payer fills in) or can't be parsed. Callers must treat null as
 * "unverifiable" and refuse to pay automatically.
 */
export function bolt11AmountMsats(invoice: string): number | null {
  const m = /^ln(?:bc|tb|bcrt|sb)(\d+)([munp])?/i.exec(String(invoice).trim().toLowerCase());
  if (!m) return null;

  const digits = m[1];
  const suffix = m[2];
  // A leading zero would be a malformed amount per the spec; reject rather than
  // guess at intent.
  if (digits.length > 1 && digits.startsWith('0')) return null;

  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return null;

  const msats = suffix ? value * MULTIPLIERS[suffix] : value * BTC_IN_MSAT;
  if (!Number.isFinite(msats) || !Number.isInteger(msats) || msats <= 0) return null;
  return msats;
}

/**
 * True when `invoice` asks for exactly `expectedMsats`. Anything unparseable or
 * amountless is false — an invoice we can't read is one we shouldn't pay.
 */
export function invoiceMatchesAmount(invoice: string, expectedMsats: number): boolean {
  const actual = bolt11AmountMsats(invoice);
  return actual !== null && actual === expectedMsats;
}
