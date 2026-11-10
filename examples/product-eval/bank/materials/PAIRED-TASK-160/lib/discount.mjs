/** percent is 0–100. Currently returns the cut amount, not the discounted price. */
export function applyDiscount(cents, percent) {
  return Math.floor((cents * percent) / 100);
}
