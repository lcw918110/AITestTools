import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostContract } from '../drivers/fakehost/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

export function loadBundledContract(id: string): HostContract & Record<string, unknown> {
  const file = join(here, `${id}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as HostContract & Record<string, unknown>;
}

export function listBundledContracts(): string[] {
  return ['opencode-v1.18'];
}
