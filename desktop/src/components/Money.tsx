import { formatMoney } from "./format";
import { useCanSeePrices } from "./roles";

/** A money value. Renders nothing for the store role. */
export function Money({ value, currency }: { value: string | number | null | undefined; currency?: string }) {
  if (!useCanSeePrices()) return null;
  return <span className="money">{formatMoney(value, currency)}</span>;
}
