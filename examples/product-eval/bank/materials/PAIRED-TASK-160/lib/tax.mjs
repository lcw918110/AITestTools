/** bps is 1/100 of a percent. Currently returns only the tax slice. */
export function addTax(cents, bps) {
  return Math.floor((cents * bps) / 10000);
}
