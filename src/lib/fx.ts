/**
 * Currency -> INR conversion for imported prices.
 *
 * Uses a static rate table (Hostiggo is INR-only). Swap `getRate` for a live
 * FX API later; the pipeline records the rate it actually used on the job so
 * historical imports stay explainable.
 */
const STATIC_RATES_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 83.3,
  EUR: 90.1,
  GBP: 105.6,
  AUD: 55.2,
  CAD: 61.0,
  AED: 22.7,
  SGD: 61.8,
  THB: 2.35,
  LKR: 0.28,
  NPR: 0.625,
};

export type FxConversion = {
  source_amount: number | null;
  source_currency: string;
  inr_amount: number | null;
  fx_rate: number;
  rate_source: "static-table" | "identity" | "unknown";
  note?: string;
};

export function getRate(currency: string): { rate: number; source: FxConversion["rate_source"] } {
  const c = currency?.toUpperCase?.() || "INR";
  if (c === "INR") return { rate: 1, source: "identity" };
  const r = STATIC_RATES_TO_INR[c];
  return r ? { rate: r, source: "static-table" } : { rate: 1, source: "unknown" };
}

export function toINR(amount: number | null, currency: string): FxConversion {
  const { rate, source } = getRate(currency);
  const c = currency?.toUpperCase?.() || "INR";
  if (amount == null) {
    return {
      source_amount: null,
      source_currency: c,
      inr_amount: null,
      fx_rate: rate,
      rate_source: source,
    };
  }
  if (source === "unknown") {
    return {
      source_amount: amount,
      source_currency: c,
      inr_amount: null,
      fx_rate: 1,
      rate_source: "unknown",
      note: `No FX rate for ${c} — host must set the INR price manually.`,
    };
  }
  return {
    source_amount: amount,
    source_currency: c,
    inr_amount: Math.round(amount * rate),
    fx_rate: rate,
    rate_source: source,
    note:
      source === "identity"
        ? undefined
        : `Converted ${amount} ${c} → ₹${Math.round(amount * rate)} at ${rate} (static rate — host should confirm).`,
  };
}
