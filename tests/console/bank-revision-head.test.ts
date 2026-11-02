import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getTask, updateTask } from '../../apps/console/bank.ts';

/**
 * 读路径必须取「当前头部修订」，不能被目录遍历顺序决定。
 *
 * 缺陷：`loadPairedItemsV1` 用 `readdirSync` 顺序逐个覆盖，同侧多个修订
 * 并存时结果取决于文件名字典序——`r10` 排在 `r9` 之前，于是回退到旧修订。
 * 真实影响：92 题现有 r3.off / r4.on / r5.on / r6.on 并存，读到哪个全看排序。
 */
function seedPair(root: string, revs: Array<{ id: string; n: number }>, head: string): void {
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'cases'), { recursive: true });
  mkdirSync(join(root, 'case-revisions'), { recursive: true });
  writeFileSync(
    join(root, 'cases', 'paired-task-99.case.json'),
    `${JSON.stringify(
      {
        case_id: 'paired-task-99',
        pair_key: 'PAIRED-TASK-99',
        head_revision_id: head,
        lifecycle: 'released',
      },
      null,
      2,
    )}\n`,
  );
  for (const rev of revs) {
    const side = rev.id.endsWith('.on') ? 'on' : 'off';
    writeFileSync(
      join(root, 'case-revisions', `${rev.id}.case-revision.json`),
      `${JSON.stringify(
        {
          case_id: 'paired-task-99',
          case_revision_id: rev.id,
          revision_number: rev.n,
          content_hash: `hash-${rev.n}`,
          stimulus: {
            kind: 'task_prompt',
            ref: 'bank/materials/PAIRED-TASK-99/prompt.txt',
            hosted_pass_token: `TOKEN_${rev.n}`,
            notes: `rev ${rev.n}`,
          },
          expect: {
            oracles: [{ id: 'exit0', type: 'exit_code', equals: 0 }],
          },
          attribution_focus: side === 'on' ? 'PROTOCOL' : 'MODEL_TASK',
        },
        null,
        2,
      )}\n`,
    );
  }
}

describe('bank 读路径 · 同侧多修订取头部', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('r9 与 r10 并存时取 r10（字典序会把 r9 排后面）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-head-'));
    seedPair(
      root,
      [
        { id: 'paired-task-99.r9.on', n: 9 },
        { id: 'paired-task-99.r10.on', n: 10 },
      ],
      'paired-task-99.r10.on',
    );

    const detail = getTask(root, 'PAIRED-TASK-99');
    expect('error' in detail).toBe(false);
    if ('error' in detail) return;
    expect(detail.on?.rev).toBe(10);
    expect(detail.on?.passToken).toBe('TOKEN_10');
  });

  it('case.json 的 head_revision_id 落后于最大修订时，仍以修订号为准（陈旧指针不得回退题面）', () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-head-'));
    seedPair(
      root,
      [
        { id: 'paired-task-99.r4.on', n: 4 },
        { id: 'paired-task-99.r5.on', n: 5 },
      ],
      'paired-task-99.r4.on',
    );

    const detail = getTask(root, 'PAIRED-TASK-99');
    expect('error' in detail).toBe(false);
    if ('error' in detail) return;
    expect(detail.on?.rev).toBe(5);
  });
});

/**
 * 写路径必须保留「表单不管理的 oracle」。
 *
 * 缺陷：`updateTask` 用表单字段（contains / not_contains）从零重建 oracles，
 * 于是 `semantic_variants` / `forbidden_variants` 以及自定义 id 的断言
 * （题库中 17 题、92 题的语义口径）在界面改一次题就被静默抹掉，题目退化。
 */
describe('bank 写路径 · 改题保留非表单 oracle', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('改 tags 时 semantic_variants / forbidden_variants 必须原样保留', async () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-keep-'));
    mkdirSync(join(root, 'bank/materials/PAIRED-TASK-99'), { recursive: true });
    mkdirSync(join(root, 'cases'), { recursive: true });
    mkdirSync(join(root, 'case-revisions'), { recursive: true });
    mkdirSync(join(root, 'dataset-releases'), { recursive: true });
    writeFileSync(join(root, 'bank/materials/PAIRED-TASK-99/prompt.txt'), 'Hold. HOLD_TRUTH\n');
    writeFileSync(
      join(root, 'cases', 'paired-task-99.case.json'),
      `${JSON.stringify(
        {
          case_id: 'paired-task-99',
          pair_key: 'PAIRED-TASK-99',
          head_revision_id: 'paired-task-99.r1.on',
          tags: ['coding'],
          lifecycle: 'released',
        },
        null,
        2,
      )}\n`,
    );
    const oracles = [
      { id: 'exit0', type: 'exit_code', equals: 0 },
      {
        id: 'hold-conclusion',
        type: 'stdout_assert',
        semantic_variants: ['(?:不|未)[^。]{0,10}(?:改写|改判)'],
        forbidden_variants: ['(?:改写|修改)(?:这?个)?(?:结论|判断)'],
        forbidden_variants_allow_negated: true,
      },
    ];
    for (const side of ['off', 'on'] as const) {
      writeFileSync(
        join(root, 'case-revisions', `paired-task-99.r1.${side}.case-revision.json`),
        `${JSON.stringify(
          {
            case_id: 'paired-task-99',
            case_revision_id: `paired-task-99.r1.${side}`,
            revision_number: 1,
            content_hash: `hash-${side}`,
            stimulus: {
              kind: 'task_prompt',
              ref: 'bank/materials/PAIRED-TASK-99/prompt.txt',
              hosted_pass_token: 'HOLD_TRUTH',
              notes: 'Hold.',
            },
            expect: { oracles },
            attribution_focus: side === 'on' ? 'PROTOCOL' : 'MODEL_TASK',
          },
          null,
          2,
        )}\n`,
      );
    }

    const r = await updateTask(root, root, 'PAIRED-TASK-99', {
      tags: 'reasoning',
      changeName: '只改标签',
    });
    expect('error' in r).toBe(false);

    const onRev = JSON.parse(
      readFileSync(join(root, 'case-revisions', 'paired-task-99.r2.on.case-revision.json'), 'utf8'),
    ) as { expect: { oracles: Array<Record<string, unknown>> } };
    const hold = onRev.expect.oracles.find((o) => o['id'] === 'hold-conclusion');
    expect(hold).toBeDefined();
    expect(hold?.['semantic_variants']).toEqual(['(?:不|未)[^。]{0,10}(?:改写|改判)']);
    expect(hold?.['forbidden_variants']).toEqual(['(?:改写|修改)(?:这?个)?(?:结论|判断)']);
    expect(hold?.['forbidden_variants_allow_negated']).toBe(true);
  });

  it('显式改 contains 时表单可管理的断言按新值重建，其余仍保留', async () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-keep-'));
    mkdirSync(join(root, 'bank/materials/PAIRED-TASK-98'), { recursive: true });
    mkdirSync(join(root, 'cases'), { recursive: true });
    mkdirSync(join(root, 'case-revisions'), { recursive: true });
    mkdirSync(join(root, 'dataset-releases'), { recursive: true });
    writeFileSync(join(root, 'bank/materials/PAIRED-TASK-98/prompt.txt'), 'Say NEW. NEW\n');
    writeFileSync(
      join(root, 'cases', 'paired-task-98.case.json'),
      `${JSON.stringify(
        {
          case_id: 'paired-task-98',
          pair_key: 'PAIRED-TASK-98',
          head_revision_id: 'paired-task-98.r1.on',
          lifecycle: 'released',
        },
        null,
        2,
      )}\n`,
    );
    for (const side of ['off', 'on'] as const) {
      writeFileSync(
        join(root, 'case-revisions', `paired-task-98.r1.${side}.case-revision.json`),
        `${JSON.stringify(
          {
            case_id: 'paired-task-98',
            case_revision_id: `paired-task-98.r1.${side}`,
            revision_number: 1,
            content_hash: `hash-${side}`,
            stimulus: {
              kind: 'task_prompt',
              ref: 'bank/materials/PAIRED-TASK-98/prompt.txt',
              hosted_pass_token: 'NEW',
              notes: 'Say NEW.',
            },
            expect: {
              oracles: [
                { id: 'exit0', type: 'exit_code', equals: 0 },
                { id: 'stdout-must', type: 'stdout_assert', contains: 'OLD' },
                { id: 'custom-anchor', type: 'stdout_assert', contains_regex: 'deploy|部署' },
              ],
            },
            attribution_focus: side === 'on' ? 'PROTOCOL' : 'MODEL_TASK',
          },
          null,
          2,
        )}\n`,
      );
    }

    const r = await updateTask(root, root, 'PAIRED-TASK-98', {
      contains: 'NEW',
      changeName: '收紧必含词',
    });
    expect('error' in r).toBe(false);

    const onRev = JSON.parse(
      readFileSync(join(root, 'case-revisions', 'paired-task-98.r2.on.case-revision.json'), 'utf8'),
    ) as { expect: { oracles: Array<Record<string, unknown>> } };
    const must = onRev.expect.oracles.find((o) => o['id'] === 'stdout-must');
    expect(must?.['contains']).toBe('NEW');
    const anchor = onRev.expect.oracles.find((o) => o['id'] === 'custom-anchor');
    expect(anchor?.['contains_regex']).toBe('deploy|部署');
  });

  it('单侧 OFF 题改题后 head 必须指向真实写出的 OFF 修订，不得悬空指向 ON', async () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-offonly-'));
    mkdirSync(join(root, 'bank/materials/PAIRED-TASK-07'), { recursive: true });
    mkdirSync(join(root, 'cases'), { recursive: true });
    mkdirSync(join(root, 'case-revisions'), { recursive: true });
    mkdirSync(join(root, 'dataset-releases'), { recursive: true });
    writeFileSync(join(root, 'bank/materials/PAIRED-TASK-07/prompt.txt'), 'Reply OK.\n');
    for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
      writeFileSync(
        join(root, 'dataset-releases', `${name}.dataset-release.json`),
        `${JSON.stringify({ dataset_release_id: name, name, case_revisions: [] }, null, 2)}\n`,
      );
    }
    writeFileSync(
      join(root, 'cases', 'paired-task-07.case.json'),
      `${JSON.stringify(
        {
          case_id: 'paired-task-07',
          pair_key: 'PAIRED-TASK-07',
          head_revision_id: 'paired-task-07.r1.off',
          tags: ['coding'],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(root, 'case-revisions', 'paired-task-07.r1.off.case-revision.json'),
      `${JSON.stringify(
        {
          case_id: 'paired-task-07',
          case_revision_id: 'paired-task-07.r1.off',
          revision_number: 1,
          content_hash: 'hash-1',
          stimulus: {
            kind: 'task_prompt',
            ref: 'bank/materials/PAIRED-TASK-07/prompt.txt',
            hosted_pass_token: 'OK',
            notes: 'Reply OK.',
          },
          expect: { oracles: [{ id: 'exit0', type: 'exit_code', equals: 0 }] },
          attribution_focus: 'MODEL_TASK',
        },
        null,
        2,
      )}\n`,
    );

    const r = await updateTask(root, root, 'PAIRED-TASK-07', {
      tags: 'smoke',
      changeName: '单侧改题',
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.off?.rev).toBe(2);

    const head = (
      JSON.parse(readFileSync(join(root, 'cases/paired-task-07.case.json'), 'utf8')) as {
        head_revision_id: string;
      }
    ).head_revision_id;
    expect(head).toBe('paired-task-07.r2.off');
    // head 必须真实存在。
    expect(
      existsSync(join(root, 'case-revisions', 'paired-task-07.r2.off.case-revision.json')),
    ).toBe(true);
  });

  it('OFF 修订号领先 ON 时，head 指向修订号更大的 OFF（不制造陈旧指针）', async () => {
    root = mkdtempSync(join(tmpdir(), 'proctor-bank-offlead-'));
    mkdirSync(join(root, 'bank/materials/PAIRED-TASK-06'), { recursive: true });
    mkdirSync(join(root, 'cases'), { recursive: true });
    mkdirSync(join(root, 'case-revisions'), { recursive: true });
    mkdirSync(join(root, 'dataset-releases'), { recursive: true });
    writeFileSync(join(root, 'bank/materials/PAIRED-TASK-06/prompt.txt'), 'Reply OK.\n');
    for (const name of ['paired-off-calibrate', 'paired-on-calibrate']) {
      writeFileSync(
        join(root, 'dataset-releases', `${name}.dataset-release.json`),
        `${JSON.stringify({ dataset_release_id: name, name, case_revisions: [] }, null, 2)}\n`,
      );
    }
    writeFileSync(
      join(root, 'cases', 'paired-task-06.case.json'),
      `${JSON.stringify(
        {
          case_id: 'paired-task-06',
          pair_key: 'PAIRED-TASK-06',
          head_revision_id: 'paired-task-06.r3.off',
          tags: ['coding'],
        },
        null,
        2,
      )}\n`,
    );
    // OFF 已有 r3，ON 只有 r2 —— 改题后 OFF=r4、ON=r3，head 应为 r4.off。
    for (const [side, rev] of [
      ['off', 3],
      ['on', 2],
    ] as const) {
      const id = `paired-task-06.r${rev}.${side}`;
      writeFileSync(
        join(root, 'case-revisions', `${id}.case-revision.json`),
        `${JSON.stringify(
          {
            case_id: 'paired-task-06',
            case_revision_id: id,
            revision_number: rev,
            content_hash: `hash-${rev}${side}`,
            stimulus: {
              kind: 'task_prompt',
              ref: 'bank/materials/PAIRED-TASK-06/prompt.txt',
              hosted_pass_token: 'OK',
              notes: 'Reply OK.',
            },
            expect: { oracles: [{ id: 'exit0', type: 'exit_code', equals: 0 }] },
            attribution_focus: side === 'on' ? 'PROTOCOL' : 'MODEL_TASK',
          },
          null,
          2,
        )}\n`,
      );
    }

    const r = await updateTask(root, root, 'PAIRED-TASK-06', {
      tags: 'smoke',
      changeName: 'OFF 领先',
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.off?.rev).toBe(4);
    expect(r.on?.rev).toBe(3);

    const head = (
      JSON.parse(readFileSync(join(root, 'cases/paired-task-06.case.json'), 'utf8')) as {
        head_revision_id: string;
      }
    ).head_revision_id;
    expect(head).toBe('paired-task-06.r4.off');
  });
});
