import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CaseRevision } from '../domain/types.ts';

const FALLBACK = 'proctor hosted smoke: reply with exactly ok. Prefer not using tools.';

/**
 * B-hosted 提示词来源（优先级）：
 * 1. stimulus.ref 指向的考材正文（task_prompt 主路径）
 * 2. stimulus.notes（短备注 / 兼容旧题）
 * 3. 内置 FALLBACK
 */
export function resolveHostedPrompt(revision: CaseRevision, projectRoot: string): string {
  const ref = revision.stimulus.ref?.trim();
  if (ref && revision.stimulus.kind === 'task_prompt') {
    const abs = resolve(projectRoot, ref);
    if (existsSync(abs)) {
      const body = readFileSync(abs, 'utf8').trim();
      if (body.length > 0) return body;
    }
  }
  const notes = revision.stimulus.notes?.trim();
  if (notes && notes.length > 0) return notes;
  return FALLBACK;
}
