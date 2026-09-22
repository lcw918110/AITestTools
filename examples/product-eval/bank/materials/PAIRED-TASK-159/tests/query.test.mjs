import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuery } from '../lib/query.js';
import { isValidName } from '../lib/validate.js';

test('parseQuery splits pairs', () => {
  assert.deepEqual(parseQuery('a=1&b=2'), { a: '1', b: '2' });
});

test('parseQuery flag without value', () => {
  assert.deepEqual(parseQuery('flag'), { flag: '' });
});

test('parseQuery empty', () => {
  assert.deepEqual(parseQuery(''), {});
});

test('isValidName', () => {
  assert.equal(isValidName('ab'), true);
  assert.equal(isValidName('A_9x'), true);
  assert.equal(isValidName(''), false);
  assert.equal(isValidName('   '), false);
  assert.equal(isValidName('1ab'), false);
});
