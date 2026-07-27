#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const args = input.args ?? {};
const workspace = input.context?.workspace;
const message = String(args.message ?? '');

if (args.mode === 'write') {
  if (typeof workspace !== 'string') {
    process.stdout.write(
      JSON.stringify({ ok: false, error: { kind: 'bad_context', message: 'no workspace' } }),
    );
    process.exit(0);
  }
  const file = join(workspace, 'out.txt');
  writeFileSync(file, message);
  process.stdout.write(
    JSON.stringify({ ok: true, result: { path: 'out.txt', bytes: message.length } }),
  );
  process.exit(0);
}

if (args.mode === 'fail') {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { kind: 'tool_rejected', message: 'forced fail' } }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ ok: true, result: { echo: message } }));
process.exit(0);
