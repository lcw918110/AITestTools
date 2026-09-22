import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDiscount } from '../lib/discount.mjs';
import { addTax } from '../lib/tax.mjs';
import { quoteTotal } from '../lib/invoice.mjs';

test('15% off 1000 cents is 850', () => {
  assert.equal(applyDiscount(1000, 15), 850);
});

test('15% off 1001 cents rounds the discount', () => {
  assert.equal(applyDiscount(1001, 15), 851);
});

test('875 bps tax on 853 cents rounds the taxed total to 928', () => {
  assert.equal(addTax(853, 875), 928);
});

test('quoteTotal uses both helpers', () => {
  assert.equal(quoteTotal(1000, 15, 875), 924);
});
