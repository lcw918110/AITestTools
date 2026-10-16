import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { collectFiles, loadCaseFile } from '../../src/exam-engine/loader.ts';
import { validateCase } from '../../src/exam-engine/validate.ts';

/**
 * Phase 0 历史样例（`tests/fixtures/legacy-phase0/`）须继续被 papers-v1 校验器接受，
 * 防止协议实现悄悄收紧规则。
 *
 * 兼容套件是声明的保证（stated guarantee），不是可选的。
 * fixtures 目录缺失必须 FAIL LOUD，不允许静默跳过。
 */
const legacyCasesDir = fileURLToPath(new URL('../fixtures/legacy-phase0/cases', import.meta.url));
const legacyRoot = fileURLToPath(new URL('../fixtures/legacy-phase0', import.meta.url));

describe('与 Phase 0 样例的行为对齐（compat: stated guarantee）', () => {
  beforeAll(() => {
    expect(existsSync(legacyCasesDir), `兼容套件 fixtures 目录缺失：${legacyCasesDir}`).toBe(true);
  });

  const files = collectFiles(legacyCasesDir, '.case.json');

  it('找得到 Phase 0 的三条样例用例', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s 无结构性错误', (file) => {
    const issues = validateCase(loadCaseFile(file, legacyRoot));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
