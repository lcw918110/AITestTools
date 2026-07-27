import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectFiles, loadCaseFile } from '../../src/exam-engine/loader.ts';
import { validateCase } from '../../src/exam-engine/validate.ts';

/**
 * Phase 0 骨架（`40-评测工具/harness/`）里的用例由零依赖校验器判为全绿。
 * 引擎接管后必须给出同样结论，否则就是协议实现悄悄收紧了规则。
 */
const legacyCasesDir = fileURLToPath(new URL('../../40-评测工具/harness/cases', import.meta.url));
const legacyRoot = fileURLToPath(new URL('../../40-评测工具/harness', import.meta.url));

describe.skipIf(!existsSync(legacyCasesDir))('与 Phase 0 校验器的行为对齐', () => {
  const files = collectFiles(legacyCasesDir, '.case.json');

  it('找得到 Phase 0 的三条样例用例', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s 无结构性错误', (file) => {
    const issues = validateCase(loadCaseFile(file, legacyRoot));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
