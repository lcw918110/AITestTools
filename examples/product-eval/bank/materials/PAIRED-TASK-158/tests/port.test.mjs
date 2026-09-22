import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PORT } from '../src/listen.js';
import { LEGACY_PORT } from '../src/legacy-compat.js';

export const EXPECTED_PUBLIC_PORT = 8443;

test('public listen port matches fixture', () => {
  assert.equal(PORT, EXPECTED_PUBLIC_PORT);
  const cfg = JSON.parse(readFileSync(new URL('../config/app.json', import.meta.url), 'utf8'));
  assert.equal(cfg.port, EXPECTED_PUBLIC_PORT);
});

test('legacy port stays on old clients', () => {
  assert.equal(LEGACY_PORT, 7777);
});
