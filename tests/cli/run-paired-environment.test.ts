/**
 * 配对实验按侧解析环境。
 *
 * 设计前提：同一道题、同一套判定口径，**只差插件开关**。
 * 而 CLI 只能传一个 `--environment`，若两侧共用，OFF 侧也会挂插件，
 * 差值就不再是「有插件 vs 无插件」——配对结论失效。
 *
 * 实测事故：`runs/20261105-135851245-syv0` 用 `--environment hosted-plugin-v1`
 * 跑 `paired-delegation-smoke`，OFF 侧产物 `plugin` 字段同样是 `.../Plugin.js`。
 */
import { describe, expect, it } from 'vitest';
import { resolveSideEnvironment, revisionSide } from '../../src/cli/commands/run.ts';
import type { CaseRevision, EnvironmentProfile } from '../../src/domain/types.ts';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function env(id: string, paired?: { off?: string; on?: string }): { doc: EnvironmentProfile } {
  const doc: EnvironmentProfile = {
    environment_profile_id: id,
    name: id,
    lifecycle: 'active',
    recipe: { kind: 'hosted' },
    ...(paired !== undefined ? { paired_environments: paired } : {}),
  };
  return { doc };
}

function rev(id: string): CaseRevision {
  return { case_revision_id: id } as unknown as CaseRevision;
}

describe('revisionSide：从修订 id 后缀判定配对侧', () => {
  it('.off / .on 后缀分别识别为 off / on', () => {
    expect(revisionSide('paired-task-160.r1.off')).toBe('off');
    expect(revisionSide('paired-task-160.r1.on')).toBe('on');
  });

  it('无后缀返回 undefined（非配对题）', () => {
    expect(revisionSide('paired-task-160.r1')).toBeUndefined();
    expect(revisionSide('solo-task.r2')).toBeUndefined();
  });

  it('后缀必须紧贴结尾，中间出现不算', () => {
    expect(revisionSide('task.off.r1')).toBeUndefined();
    expect(revisionSide('task.on.r1')).toBeUndefined();
  });
});

describe('resolveSideEnvironment：按侧切换环境', () => {
  const plain = env('hosted-plain-v1');
  const plugin = env('hosted-plugin-v1', { off: 'hosted-plain-v1' });
  const envs = [plain, plugin];

  it('OFF 侧解析到映射目标（不挂插件的环境）', () => {
    const got = resolveSideEnvironment(rev('paired-task-160.r1.off'), plugin.doc, envs);
    expect(got.environment_profile_id).toBe('hosted-plain-v1');
    expect(got.recipe.host_plugin).toBeUndefined();
  });

  it('ON 侧无映射时用基准环境（挂插件）', () => {
    const got = resolveSideEnvironment(rev('paired-task-160.r1.on'), plugin.doc, envs);
    expect(got.environment_profile_id).toBe('hosted-plugin-v1');
  });

  it('非配对题（无侧后缀）用基准环境', () => {
    const got = resolveSideEnvironment(rev('solo-task.r1'), plugin.doc, envs);
    expect(got.environment_profile_id).toBe('hosted-plugin-v1');
  });

  it('基准环境未声明 paired_environments 时原样返回', () => {
    const got = resolveSideEnvironment(rev('paired-task-160.r1.off'), plain.doc, envs);
    expect(got.environment_profile_id).toBe('hosted-plain-v1');
  });

  it('映射目标不存在时报错，不静默回落', () => {
    // 静默回落会让配对前提再次失效而无从察觉，故必须显式失败。
    const broken = env('hosted-plugin-v1', { off: 'no-such-env' });
    expect(() =>
      resolveSideEnvironment(rev('paired-task-160.r1.off'), broken.doc, [broken]),
    ).toThrow(/指向不存在的环境：no-such-env/);
  });

  it('映射回自身时不重复查找（等价于无映射）', () => {
    const self = env('hosted-plugin-v1', { off: 'hosted-plugin-v1' });
    const got = resolveSideEnvironment(rev('paired-task-160.r1.off'), self.doc, [self]);
    expect(got.environment_profile_id).toBe('hosted-plugin-v1');
  });
});

describe('run.json 逐题环境记账', () => {
  it('items[].environment 记录实际执行环境，不是基准值', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-paired-meta-'));
    try {
      const written = writeRunArtifacts({
        runsRoot,
        meta: {
          run_id: 'paired-meta-1',
          dataset: 'paired-smoke',
          environment: 'hosted-plugin-v1',
          started_at: '2026-11-09T00:00:00.000Z',
          project_root: '/tmp',
          items: [
            { id: 'paired-task-1.r1.off', rev: 1, environment: 'hosted-plain-v1' },
            { id: 'paired-task-1.r1.on', rev: 1, environment: 'hosted-plugin-v1' },
          ],
        },
        results: [
          {
            item_id: 'paired-task-1.r1.off',
            item_rev: 1,
            pass: true,
            oracle_failures: [],
            metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
          },
          {
            item_id: 'paired-task-1.r1.on',
            item_rev: 1,
            pass: true,
            oracle_failures: [],
            metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
          },
        ],
      });

      const runJson = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
        environment: string;
        items: Array<{ id: string; environment?: string }>;
      };
      // 顶层仍是命令行基准值（保持既有语义），逐题才是实际执行环境。
      expect(runJson.environment).toBe('hosted-plugin-v1');
      expect(runJson.items[0]?.environment).toBe('hosted-plain-v1');
      expect(runJson.items[1]?.environment).toBe('hosted-plugin-v1');

      // 报告表头补「环境」列，否则单看 report.md 仍会误读为全部同一环境。
      const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
      expect(report).toContain('| item | rev | 环境 | pass |');
      expect(report).toContain('hosted-plain-v1');
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it('无逐题差异时不加环境列（保持既有报告格式）', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-paired-meta-flat-'));
    try {
      const written = writeRunArtifacts({
        runsRoot,
        meta: {
          run_id: 'paired-meta-2',
          dataset: 'smoke',
          environment: 'fold-v1',
          started_at: '2026-11-09T00:00:00.000Z',
          project_root: '/tmp',
          items: [{ id: 'solo.r1', rev: 1 }],
        },
        results: [
          {
            item_id: 'solo.r1',
            item_rev: 1,
            pass: true,
            oracle_failures: [],
            metrics: { a_case_pass_rate: 1, a_invariant_violations: 0 },
          },
        ],
      });
      const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
      expect(report).not.toContain('| item | rev | 环境 |');
      expect(report).toContain('| item | rev | pass |');
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });
});
