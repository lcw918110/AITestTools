import { applyDiscount } from './discount.mjs';
import { addTax } from './tax.mjs';

// INVOICE_CORE keep this wiring; fix helpers instead.
export function quoteTotal(cents, percent, bps) {
  return addTax(applyDiscount(cents, percent), bps);
}
