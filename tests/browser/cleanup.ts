import { rmSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';

export default function cleanup(config: FullConfig) {
  const root = config.metadata['temporaryProjectRoot'];
  if (typeof root === 'string') rmSync(root, { recursive: true, force: true });
}
