import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRunArtifacts } from '../../src/run/write-artifacts.ts';
import { extractCaseId } from '../../src/run/consistency.ts';
import type { AxisItemResult } from '../../src/run/runner-types.ts';

function result(itemId: string, pass: boolean): AxisItemResult {
  return {
    item_id: itemId,
    item_rev: 1,
    pass,
    oracle_failures: [],
    metrics: { a_case_pass_rate: pass ? 1 : 0, a_invariant_violations: 0 },
  };
}

function meta(runId: string, itemId: string): Parameters<typeof writeRunArtifacts>[0]['meta'] {
  return {
    run_id: runId,
    dataset: 'model-core',
    environment: 'model-direct-v1',
    started_at: '2026-10-19T00:00:00.000Z',
    project_root: '/tmp',
    items: [{ id: itemId, rev: 1 }],
  };
}

describe('writeRunArtifacts 一致性量化报告（ADR-0010）', () => {
  it('repeats>1 时 report.md 输出 pass^k 与成功率范围段落', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-consistency-'));
    const results = [
      result('model-case.r1::r0', true),
      result('model-case.r1::r1', true),
      result('model-case.r1::r2', true),
      result('model-case.r1::r3', false),
    ];
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('consistency-1', 'model-case.r1'),
      results,
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('## 一致性量化（pass^k / 成功率范围）');
    expect(report).toContain('pass^k: 0%');
    expect(report).toContain('成功率范围: 75%~75%');
    expect(report).toContain('flaky: 存在');
  });

  it('repeats=1 时 report.md 不输出一致性量化段落', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-consistency-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('consistency-2', 'behavior-case.r1'),
      results: [result('behavior-case.r1', true)],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).not.toContain('## 一致性量化');
  });
});

describe('writeRunArtifacts 逐题 pass 与 repeats 口径一致', () => {
  it('repeats>1 时 run.json 的 items[].pass 不取最后一个 trial，而与 a_case_pass_rate 同口径', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-pass-'));
    // 3 过 1 挂，且「最后一个 trial 挂」——旧实现按去后缀 key 建 Map，后者覆盖前者，
    // items[].pass 会取到 false，与 a_case_pass_rate=0.75 自相矛盾。
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-pass-1', 'model-case.r1'),
      results: [
        result('model-case.r1::r0', true),
        result('model-case.r1::r1', true),
        result('model-case.r1::r2', true),
        result('model-case.r1::r3', false),
      ],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    expect(run.items).toHaveLength(1);
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    // 4 个 trial 里 3 过：题级通过率 0.75，不能塌缩成最后一个 trial 的 false。
    expect(item.pass_rate).toBe(0.75);
    expect(item.trials).toBe(4);
    // 题级 pass 必须与 a_case_pass_rate 同口径（本题 0.75，未达 1，故为 false）。
    expect(item.pass).toBe(false);

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    expect(report).toContain('pass^k: 0%');
  });

  it('repeats>1 且全部 trial 通过时 items[].pass 为 true', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-pass-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-pass-2', 'model-case.r1'),
      results: [result('model-case.r1::r0', true), result('model-case.r1::r1', true)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass_rate).toBe(1);
    expect(item.trials).toBe(2);
    expect(item.pass).toBe(true);
  });

  it('repeats>1 且最后一个 trial 通过、前面挂过时 items[].pass 仍为 false', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-pass-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-pass-3', 'model-case.r1'),
      results: [result('model-case.r1::r0', false), result('model-case.r1::r1', true)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass_rate).toBe(0.5);
    expect(item.trials).toBe(2);
    // 旧实现会取最后一个 trial 的 true，把 flaky 题记成通过。
    expect(item.pass).toBe(false);
  });

  it('repeats=1 时 items[].pass 保持原样且不引入 pass_rate/trials 噪声', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-pass-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-pass-4', 'behavior-case.r1'),
      results: [result('behavior-case.r1', true)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass).toBe(true);
    expect(item.pass_rate).toBeUndefined();
    expect(item.trials).toBeUndefined();
  });
});

describe('writeRunArtifacts 兼容 B-direct 的 `::模型::rN` item_id 形状', () => {
  it('B-direct 形状（case::fixture::rN）能匹配到 meta.items 并写入题级 pass', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-bdirect-'));
    // 实测历史产物形状：examples/demo-project/runs/20260726-073515308-tab8
    // item_id = `DEMO-B-TOOL-SCHEMA-01::fixture-a::r1`，meta.items[].id = `DEMO-B-TOOL-SCHEMA-01`。
    // 只剥最后一层 `::rN` 会得到 `...::fixture-a`，与 id 不等，导致 items[].pass 完全缺失。
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-bdirect-1', 'DEMO-B-TOOL-SCHEMA-01'),
      results: [
        result('DEMO-B-TOOL-SCHEMA-01::fixture-a::r1', true),
        result('DEMO-B-TOOL-SCHEMA-01::fixture-a::r2', true),
        result('DEMO-B-TOOL-SCHEMA-01::fixture-a::r3', false),
      ],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; pass_rate?: number; trials?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.trials).toBe(3);
    expect(item.pass_rate).toBeCloseTo(2 / 3, 10);
    expect(item.pass).toBe(false);
  });

  it('题号互为前缀时（A-01 与 A-010）不串题', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-bdirect-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'items-bdirect-2',
        dataset: 'model-core',
        environment: 'model-direct-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [
          { id: 'DEMO-B-01', rev: 1 },
          { id: 'DEMO-B-010', rev: 1 },
        ],
      },
      results: [
        result('DEMO-B-01::fixture-a::r1', true),
        result('DEMO-B-010::fixture-a::r1', false),
      ],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean }>;
    };
    expect(run.items.find((i) => i.id === 'DEMO-B-01')?.pass).toBe(true);
    expect(run.items.find((i) => i.id === 'DEMO-B-010')?.pass).toBe(false);
  });

  it('meta.items 的 id 在结果里找不到时原样返回，不伪造 pass', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-bdirect-'));
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-bdirect-3', 'not-run-case.r1'),
      results: [result('other-case.r1::r0', true)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.id).toBe('not-run-case.r1');
    expect(item.pass).toBeUndefined();
  });

  it('题号互为前缀且含 :: 时按最长匹配归属，不串题', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-bdirect-'));
    // `A` 与 `A::x` 同时存在时，`A::x::model::r0` 必须归到更长的 `A::x`，而不是 `A`。
    // 用 `::model::r0` 而非 `::r0`：后者去后缀后就是 `A::x`，会走精确匹配早返回，
    // 最长匹配循环零执行，测不出归属逻辑。
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'items-prefix-ambiguity',
        dataset: 'model-core',
        environment: 'model-direct-v1',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [
          { id: 'A', rev: 1 },
          { id: 'A::x', rev: 1 },
        ],
      },
      results: [result('A::x::model::r0', true)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ id: string; pass?: boolean }>;
    };
    expect(run.items.find((i) => i.id === 'A::x')?.pass).toBe(true);
    expect(run.items.find((i) => i.id === 'A')?.pass).toBeUndefined();
  });

  it('模型名以 r 开头时不被误当 trial 后缀剥掉', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-bdirect-'));
    // `::reflect` 与 `::r1` 只差一个字母：旧 extractCaseId 用 lastIndexOf('::r') 会把
    // `DEMO-B-01::reflect` 剥成 `DEMO-B-01`（把模型名当成了 trial 后缀），
    // 于是该模型的结果被错记成「题号本身的一次观测」，与 `::r1` 混成同一题。
    // 修复后 `::reflect` 原样保留，再由 resolveCaseId 按前缀归到 `DEMO-B-01`。
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-bdirect-4', 'DEMO-B-01'),
      results: [result('DEMO-B-01::reflect', true), result('DEMO-B-01::r1', false)],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; trials?: number; pass_rate?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    // 两个模型都是该题的观测：题级 pass 全过才算通过。
    expect(item.pass).toBe(false);
    // 关键断言：两条都归到同一题，观测数为 2。
    expect(item.trials).toBe(2);
    expect(item.pass_rate).toBe(0.5);
  });

  it('extractCaseId 不把以 r 开头的模型名当 trial 后缀（直接契约）', () => {
    // 上一条测的是 writeRunArtifacts 的归并结果，新旧实现都会归并到同一题，
    // 无法单独证伪 extractCaseId 的修复。这里直接锁 extractCaseId 的契约：
    // 旧实现返回 `DEMO-B-01`（误剥），新实现原样保留。
    expect(extractCaseId('DEMO-B-01::reflect')).toBe('DEMO-B-01::reflect');
    expect(extractCaseId('DEMO-B-01::r1-mini')).toBe('DEMO-B-01::r1-mini');
    // 真正的 trial 尾缀仍要剥。
    expect(extractCaseId('DEMO-B-01::reflect::r2')).toBe('DEMO-B-01::reflect');
    expect(extractCaseId('DEMO-B-01::r1')).toBe('DEMO-B-01');
  });
});

describe('writeRunArtifacts 多 trial 辅助字段按聚合口径留痕', () => {
  it('任一 trial 超时则 timed_out 为真，不因首个 trial 正常而抹掉', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    const ok = result('case.r1::r0', true);
    const slow: AxisItemResult = {
      ...result('case.r1::r1', false),
      timed_out: true,
      host_exit: 0,
      workspace_ok: true,
    };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-1', 'case.r1'),
      results: [ok, slow],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass?: boolean; timed_out?: boolean; pass_rate?: number }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass_rate).toBe(0.5);
    expect(item.timed_out).toBe(true);
  });

  it('任一 trial 工作区异常则 workspace_ok 为假', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    const good: AxisItemResult = { ...result('case.r1::r0', true), workspace_ok: true };
    const bad: AxisItemResult = { ...result('case.r1::r1', false), workspace_ok: false };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-2', 'case.r1'),
      results: [good, bad],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ workspace_ok?: boolean }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.workspace_ok).toBe(false);
  });

  it('host_exit 保留首个非 0 值，不被首个 trial 的 0 覆盖', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    const ok: AxisItemResult = { ...result('case.r1::r0', true), host_exit: 0 };
    const crashed: AxisItemResult = { ...result('case.r1::r1', false), host_exit: 3 };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-3', 'case.r1'),
      results: [ok, crashed],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ host_exit?: number | null }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.host_exit).toBe(3);
  });

  it('host_exit 为 null（被杀/超时）时不得回落成 0', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    // 旧实现只挑 `typeof === 'number'` 的非 0 值，`null` 被过滤后回落成 0，
    // 于是 run.json 写「正常退出 0」，而 report.md 的 formatHostExitCell 渲染成「被杀」。
    // 顺序必须是 [null, 0]：旧实现「取最后一个 trial」会拿到 0，新实现才保留 null。
    const killed: AxisItemResult = {
      ...result('case.r1::r0', false),
      timed_out: true,
      host_exit: null,
    };
    const okAfter: AxisItemResult = { ...result('case.r1::r1', true), host_exit: 0 };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-null', 'case.r1'),
      results: [killed, okAfter],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ host_exit?: number | null }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.host_exit).toBeNull();
  });

  it('全部 trial 都未观测 workspace_ok 时不写该字段', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    const a = result('case.r1::r0', false);
    const b = result('case.r1::r1', true);
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-none', 'case.r1'),
      results: [a, b],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ workspace_ok?: boolean }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.workspace_ok).toBeUndefined();
  });

  it('首个 trial 异常、后续 trial 正常时，聚合仍保留异常（反向覆盖）', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-rev-'));
    // 既有三条聚合测试都把异常 trial 放在最后，旧实现「后者覆盖前者」恰好也能通过；
    // 这里把异常放最前，专门证伪「只看最后一个 trial」的实现。
    const slowFirst: AxisItemResult = {
      ...result('case.r1::r0', false),
      timed_out: true,
      host_exit: null,
      workspace_ok: false,
      materials_mutated: true,
    };
    const okSecond: AxisItemResult = {
      ...result('case.r1::r1', true),
      timed_out: false,
      host_exit: 0,
      workspace_ok: true,
      materials_mutated: false,
    };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-rev', 'case.r1'),
      results: [slowFirst, okSecond],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{
        pass?: boolean;
        timed_out?: boolean;
        host_exit?: number | null;
        workspace_ok?: boolean;
        materials_mutated?: boolean;
      }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass).toBe(false);
    expect(item.timed_out).toBe(true);
    expect(item.host_exit).toBeNull();
    expect(item.workspace_ok).toBe(false);
    expect(item.materials_mutated).toBe(true);
  });

  it('pass_token 取首个有观测的 trial，不被无观测的首个 trial 抹掉', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    // 首个 trial 因预检失败没有鉴权观测，第二个 trial 有：旧实现只取 first，
    // 会把真实观测整段丢掉。
    const noToken = result('case.r1::r0', false);
    const withToken: AxisItemResult = {
      ...result('case.r1::r1', true),
      pass_token: 'DONE',
      pass_token_present: true,
    };
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-token', 'case.r1'),
      results: [noToken, withToken],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass_token?: string; pass_token_present?: boolean }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass_token).toBe('DONE');
    expect(item.pass_token_present).toBe(true);
  });

  it('pass_token 有观测在前、无观测在后时仍保留观测（反向顺序）', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-agg-'));
    // 上一条是 [无观测, 有观测]，旧实现「取最后一个 trial」恰好拿到有观测的那条，测不出问题。
    // 这里把顺序反过来：旧实现会取到无观测的末条，把观测丢掉。
    const withToken: AxisItemResult = {
      ...result('case.r1::r0', true),
      pass_token: 'DONE',
      pass_token_present: true,
    };
    const noToken = result('case.r1::r1', false);
    const written = writeRunArtifacts({
      runsRoot,
      meta: meta('items-agg-token-rev', 'case.r1'),
      results: [withToken, noToken],
    });

    const run = JSON.parse(readFileSync(join(written.dir, 'run.json'), 'utf8')) as {
      items: Array<{ pass_token?: string; pass_token_present?: boolean }>;
    };
    const item = run.items[0];
    if (item === undefined) throw new Error('run.json 缺 items[0]');
    expect(item.pass_token).toBe('DONE');
    expect(item.pass_token_present).toBe(true);
  });

  it('B-direct 形状的逐题环境写进 report.md，不回落顶层环境', () => {
    const runsRoot = mkdtempSync(join(tmpdir(), 'proctor-items-env-'));
    // 配对题按侧解析环境后，meta.items 记的是按侧环境；B-direct 的 item_id 形如
    // `<case>::<模型名>::r<N>`，若只剥 `::rN` 会查不到 envById 而回落顶层环境。
    const written = writeRunArtifacts({
      runsRoot,
      meta: {
        run_id: 'items-env-bdirect',
        dataset: 'paired-delegation-smoke',
        environment: 'base-env',
        started_at: '2026-10-19T00:00:00.000Z',
        project_root: '/tmp',
        items: [{ id: 'C1.off', rev: 1, environment: 'off-env' }],
      },
      results: [result('C1.off::fixture-a::r0', true)],
    });

    const report = readFileSync(join(written.dir, 'report.md'), 'utf8');
    // 报告顶部本来就有 `- environment: base-env` 的全局行，只断言表格行里的环境列。
    const row = report.split('\n').find((l) => l.startsWith('| C1.off::fixture-a::r0 |'));
    if (row === undefined) throw new Error('report.md 缺该题表格行');
    expect(row).toContain('off-env');
    expect(row).not.toContain('base-env');
  });
});
