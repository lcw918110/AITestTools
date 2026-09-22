import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  nextCreateTaskId,
  parseTags,
  summarizeValidateLog,
  updateTask,
} from '../../apps/console/bank.ts';

function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'proctor-bank-'));
  mkdirSync(join(root, 'bank/materials'), { recursive: true });
  mkdirSync(join(root, 'bank/items/B'), { recursive: true });
  mkdirSync(join(root, 'papersets'), { recursive: true });
  for (const name of [
    'paired-off.json',
    'paired-on.json',
    'eval-model.json',
    'eval-agent.json',
    'eval-model-alt.json',
    'paired-off-calibrate.json',
    'paired-off-alt-calibrate.json',
    'paired-on-calibrate.json',
    'paired-on-alt-calibrate.json',
  ]) {
    writeFileSync(
      join(root, 'papersets', name),
      `${JSON.stringify({ name: name.replace(/\.json$/, ''), items: [] }, null, 2)}\n`,
    );
  }
  return root;
}

const okValidate = async () => ({ exitCode: 0, ok: true, log: '1/1 试题通过' });

function makeTask(
  project: string,
  body: Parameters<typeof createTask>[1],
  options?: Parameters<typeof createTask>[2],
) {
  return createTask(project, { testSetId: 'calibrate', ...body }, options);
}

describe('console bank', () => {
  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('parseTags 接受可选类型、拒绝废弃标签', () => {
    expect(parseTags(undefined)).toEqual({ ok: true, tags: [] });
    expect(parseTags('coding, docs')).toEqual({ ok: true, tags: ['coding', 'docs'] });
    expect(parseTags(['coding', 'coding'])).toEqual({ ok: true, tags: ['coding'] });
    expect(parseTags('effect')).toMatchObject({ ok: false });
    expect(parseTags('bad tag')).toMatchObject({ ok: false });
  });

  it('录题必须选测试集', async () => {
    root = seedProject();
    const miss = await createTask(root, {
      taskId: 'PAIRED-TASK-70',
      prompt: 'Reply with exactly NEEDSET.',
      passToken: 'NEEDSET',
    });
    expect(miss).toMatchObject({ code: 400, error: '请选择测试集' });
  });

  it('create → list → get → update → delete', async () => {
    root = seedProject();
    const created = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly Z.',
        passToken: 'Z',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.complete).toBe(true);
    expect(created.passToken).toBe('Z');
    expect(created.off?.id).toBe('EVAL-B-PAIRED-TASK-99-OFF');
    expect(created.off?.rev).toBe(1);

    const listed = listTasks(root);
    const row = listed.find((t) => t.taskId === 'PAIRED-TASK-99');
    expect(row?.complete).toBe(true);
    expect(row?.completeLabel).toBe('完整');
    expect(row?.versionLabel).toContain('无插件 v1');
    expect(row?.labelPassToken).toBe('Z');
    expect(row?.testSetIds).toEqual(['calibrate']);
    expect(row?.promptPreview).toContain('Reply with exactly Z');
    expect(nextCreateTaskId(root)).toBe('PAIRED-TASK-100');

    const offDoc = JSON.parse(
      readFileSync(join(root, 'bank/items/B/eval-b-paired-task-99-off.item.json'), 'utf8'),
    ) as {
      tags?: string[];
      stimulus: { notes: string };
      expect: { oracles: Array<{ type: string; contains?: string }> };
    };
    const onDoc = JSON.parse(
      readFileSync(join(root, 'bank/items/B/eval-b-paired-task-99-on.item.json'), 'utf8'),
    ) as {
      intent: { protocol_probes?: string[] };
      expect: { oracles: unknown[] };
    };
    expect(offDoc.tags ?? []).toEqual([]);
    expect(offDoc.stimulus.notes).not.toMatch(/Do not use tools/i);
    expect(offDoc.expect.oracles.some((o) => o.type === 'exit_code')).toBe(true);
    expect(
      offDoc.expect.oracles.some((o) => o.type === 'stdout_assert' && o.contains === 'Z'),
    ).toBe(true);
    expect(onDoc.intent.protocol_probes).toEqual(['RuntimeStarted', 'JournalEnvelope']);
    expect(JSON.stringify(onDoc.expect.oracles)).toBe(JSON.stringify(offDoc.expect.oracles));

    const calOff = JSON.parse(
      readFileSync(join(root, 'papersets/paired-off-calibrate.json'), 'utf8'),
    ) as { items: string[] };
    const fullOff = JSON.parse(readFileSync(join(root, 'papersets/paired-off.json'), 'utf8')) as {
      items: string[];
    };
    const evalModel = JSON.parse(readFileSync(join(root, 'papersets/eval-model.json'), 'utf8')) as {
      items: string[];
    };
    const calOn = JSON.parse(
      readFileSync(join(root, 'papersets/paired-on-calibrate.json'), 'utf8'),
    ) as { items: string[] };
    const altOff = JSON.parse(
      readFileSync(join(root, 'papersets/paired-off-alt-calibrate.json'), 'utf8'),
    ) as { items: string[] };
    const altOn = JSON.parse(
      readFileSync(join(root, 'papersets/paired-on-alt-calibrate.json'), 'utf8'),
    ) as { items: string[] };
    expect(calOff.items).toContain('EVAL-B-PAIRED-TASK-99-OFF');
    expect(calOn.items).toContain('EVAL-B-PAIRED-TASK-99-ON');
    expect(altOff.items).not.toContain('EVAL-B-PAIRED-TASK-99-OFF');
    expect(altOn.items).not.toContain('EVAL-B-PAIRED-TASK-99-ON');
    expect(fullOff.items).not.toContain('EVAL-B-PAIRED-TASK-99-OFF');
    expect(evalModel.items).not.toContain('EVAL-B-PAIRED-TASK-99-OFF');

    const noChange = await updateTask(root, root, 'PAIRED-TASK-99', {
      prompt: 'Reply with exactly ZZ.',
      passToken: 'ZZ',
    });
    expect(noChange).toMatchObject({ code: 400 });

    const updated = await updateTask(root, root, 'PAIRED-TASK-99', {
      prompt: 'Reply with exactly ZZ.',
      passToken: 'ZZ',
      changeName: '收紧终态词',
    });
    expect('error' in updated).toBe(false);
    if ('error' in updated) return;
    expect(updated.passToken).toBe('ZZ');
    expect(updated.off?.rev).toBe(2);
    expect(updated.on?.rev).toBe(2);
    expect(readFileSync(join(root, 'bank/materials/PAIRED-TASK-99/prompt.txt'), 'utf8')).toContain(
      'ZZ',
    );

    const dup = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-99',
        prompt: 'Reply with exactly x.',
        passToken: 'x',
      },
      { validate: okValidate },
    );
    expect(dup).toMatchObject({ code: 409 });

    expect(deleteTask(root, 'PAIRED-TASK-99')).toMatchObject({ code: 400 });
    expect(deleteTask(root, 'PAIRED-TASK-99', 'WRONG')).toMatchObject({ code: 400 });
    const deleted = deleteTask(root, 'PAIRED-TASK-99', 'PAIRED-TASK-99');
    expect(deleted).toEqual({ ok: true, taskId: 'PAIRED-TASK-99' });
    expect(listTasks(root).some((t) => t.taskId === 'PAIRED-TASK-99')).toBe(false);
    expect(getTask(root, 'PAIRED-TASK-99')).toMatchObject({ code: 404 });
  });

  it('录题与改题可写任务类型', async () => {
    root = seedProject();
    const created = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-88',
        prompt: 'Reply with exactly TAGOK.',
        passToken: 'TAGOK',
        tags: 'coding',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.tags).toEqual(['coding']);
    const offDoc = JSON.parse(
      readFileSync(join(root, 'bank/items/B/eval-b-paired-task-88-off.item.json'), 'utf8'),
    ) as { tags?: string[] };
    expect(offDoc.tags).toEqual(['coding']);
    const banned = await makeTask(root, {
      taskId: 'PAIRED-TASK-89',
      prompt: 'Reply with exactly NOPE.',
      passToken: 'NOPE',
      tags: ['effect'],
    });
    expect(banned).toMatchObject({ code: 400 });
    const updated = await updateTask(root, root, 'PAIRED-TASK-88', {
      tags: 'docs',
      changeName: '改任务类型',
    });
    expect('error' in updated).toBe(false);
    if ('error' in updated) return;
    expect(updated.tags).toEqual(['docs']);
  });

  it('rejects token not in prompt (C-B-30)', async () => {
    root = seedProject();
    const created = await makeTask(root, {
      taskId: 'PAIRED-TASK-90',
      prompt: 'Say hello.',
      passToken: 'ACK',
    });
    expect(created).toMatchObject({ code: 400, error: '请把终态词写进题干' });

    await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-91',
        prompt: 'Reply with exactly ACK.',
        passToken: 'ACK',
      },
      { validate: okValidate },
    );
    const put = await updateTask(root, root, 'PAIRED-TASK-91', {
      prompt: 'Say hello.',
      passToken: 'ACK',
      changeName: '误改题干',
    });
    expect(put).toMatchObject({ code: 400, error: '请把终态词写进题干' });
  });

  it('rejects PUT without changeName (C-B-31)', async () => {
    root = seedProject();
    await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-92',
        prompt: 'Reply with exactly T.',
        passToken: 'T',
      },
      { validate: okValidate },
    );
    expect(
      await updateTask(root, root, 'PAIRED-TASK-92', {
        prompt: 'Reply with exactly T2.',
        passToken: 'T2',
        changeName: 'abc',
      }),
    ).toMatchObject({ code: 400 });
  });

  it('rolls back create when validate fails (C-B-32)', async () => {
    root = seedProject();
    const fail = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-93',
        prompt: 'Reply with exactly ROLL.',
        passToken: 'ROLL',
      },
      {
        validate: async () => ({ exitCode: 1, ok: false, log: 'FAIL' }),
      },
    );
    expect(fail).toMatchObject({ code: 500 });
    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-93'))).toBe(false);
    expect(existsSync(join(root, 'bank/items/B/eval-b-paired-task-93-off.item.json'))).toBe(false);
    const paperset = JSON.parse(
      readFileSync(join(root, 'papersets/paired-off-calibrate.json'), 'utf8'),
    ) as { items: string[] };
    expect(paperset.items).not.toContain('EVAL-B-PAIRED-TASK-93-OFF');
  });

  it('rejects bad create taskId (C-B-34)', async () => {
    root = seedProject();
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-L0TMP',
        prompt: 'Reply with exactly X.',
        passToken: 'X',
      }),
    ).toMatchObject({ code: 400 });
    expect(
      await makeTask(root, {
        taskId: '../X',
        prompt: 'a',
        passToken: 'a',
      }),
    ).toMatchObject({ code: 400 });
    expect(deleteTask(root, 'nope', 'nope')).toMatchObject({ code: 400 });
  });

  it('rejects invalid passToken format', async () => {
    root = seedProject();
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-95',
        prompt: 'Reply with exactly bad token.',
        passToken: 'bad token',
      }),
    ).toMatchObject({ code: 400, error: '终态词格式非法（仅字母数字_-，禁止空白）' });
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-95',
        prompt: 'x',
        passToken: '',
      }),
    ).toMatchObject({ code: 400 });
  });

  it('rejects create taskId with single digit (C-B-34 exact)', async () => {
    root = seedProject();
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-1',
        prompt: 'Reply with exactly X.',
        passToken: 'X',
      }),
    ).toMatchObject({ code: 400, error: '题号须匹配 PAIRED-TASK-NN（至少两位数字）' });
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK',
        prompt: 'Reply with exactly X.',
        passToken: 'X',
      }),
    ).toMatchObject({ code: 400, error: '题号须匹配 PAIRED-TASK-NN（至少两位数字）' });
  });

  it('rejects delete without confirmId (C-B-33 exact)', async () => {
    root = seedProject();
    await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-96',
        prompt: 'Reply with exactly DEL.',
        passToken: 'DEL',
      },
      { validate: okValidate },
    );
    expect(deleteTask(root, 'PAIRED-TASK-96')).toMatchObject({
      code: 400,
      error: '请原样输入题号确认删除',
    });
    expect(deleteTask(root, 'PAIRED-TASK-96', '')).toMatchObject({
      code: 400,
      error: '请原样输入题号确认删除',
    });
    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-96/prompt.txt'))).toBe(true);
  });

  it('accepts legacy hosted_pass_token field', async () => {
    root = seedProject();
    const created = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-94',
        prompt: 'Reply with exactly LEG.',
        hosted_pass_token: 'LEG',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    if ('error' in created) return;
    expect(created.hosted_pass_token).toBe('LEG');
  });

  it('summarizeValidateLog', () => {
    expect(summarizeValidateLog('10/10 试题通过协议校验，0 个错误\n', 0)).toBe(
      '10/10 试题通过协议校验，0 个错误',
    );
    expect(summarizeValidateLog('boom', 1)).toContain('失败');
  });

  it('rejects Text-only / 禁工具题干', async () => {
    root = seedProject();
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-80',
        prompt: 'Text-only reply. Write TOOL_OK at the end.',
        passToken: 'TOOL_OK',
      }),
    ).toMatchObject({
      code: 400,
      error: '题干禁止 Text-only / 禁工具 / 禁探索仓库；新题须能用工具或仓库才能过',
    });
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-80',
        prompt: 'Do not use tools. Seal with TOOL_OK.',
        passToken: 'TOOL_OK',
      }),
    ).toMatchObject({ code: 400 });
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-80',
        prompt: 'Do not explore the repo. Seal with TOOL_OK.',
        passToken: 'TOOL_OK',
      }),
    ).toMatchObject({ code: 400 });
    expect(existsSync(join(root, 'bank/materials/PAIRED-TASK-80'))).toBe(false);
    const smoke = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-80',
        prompt: 'Text-only reply. Write SMOKE_OK at the end.',
        passToken: 'SMOKE_OK',
        allowSmokeTextOnly: true,
      },
      { validate: okValidate },
    );
    expect('error' in smoke).toBe(false);
  });

  it('rejects colliding passToken', async () => {
    root = seedProject();
    await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-81',
        prompt: 'Use grep then seal with UNIQUE_A.',
        passToken: 'UNIQUE_A',
      },
      { validate: okValidate },
    );
    expect(
      await makeTask(root, {
        taskId: 'PAIRED-TASK-82',
        prompt: 'Use grep then seal with UNIQUE_A.',
        passToken: 'UNIQUE_A',
      }),
    ).toMatchObject({ code: 400, error: '终态词已被 PAIRED-TASK-81 占用，请换一个' });
  });

  it('writes contains / not_contains oracles', async () => {
    root = seedProject();
    const created = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-83',
        prompt: 'Search the repo, then seal with MUST_HIT.',
        passToken: 'MUST_HIT',
        contains: 'tool=grep',
        notContains: 'diff --git',
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);
    const offDoc = JSON.parse(
      readFileSync(join(root, 'bank/items/B/eval-b-paired-task-83-off.item.json'), 'utf8'),
    ) as {
      expect: { oracles: Array<{ id?: string; contains?: string; not_contains?: string }> };
    };
    expect(offDoc.expect.oracles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'stdout-must', contains: 'tool=grep' }),
        expect.objectContaining({ id: 'stdout-forbid', not_contains: 'diff --git' }),
      ]),
    );
  });

  it('update persists contains / not_contains oracles (C-B-35)', async () => {
    root = seedProject();
    const created = await makeTask(
      root,
      {
        taskId: 'PAIRED-TASK-84',
        prompt: 'Search the repo, then seal with UPD_HIT.',
        passToken: 'UPD_HIT',
        contains: ['tool=grep', 'tool=ls'],
        notContains: ['diff --git'],
      },
      { validate: okValidate },
    );
    expect('error' in created).toBe(false);

    const offFile = join(root, 'bank/items/B/eval-b-paired-task-84-off.item.json');
    const onFile = join(root, 'bank/items/B/eval-b-paired-task-84-on.item.json');

    const updated = await updateTask(root, root, 'PAIRED-TASK-84', {
      changeName: '修改断言',
      contains: ['tool=find'],
      notContains: ['rm -rf', 'secret'],
    });
    expect('error' in updated).toBe(false);
    if ('error' in updated) return;

    for (const file of [offFile, onFile]) {
      const doc = JSON.parse(readFileSync(file, 'utf8')) as {
        expect: {
          oracles: Array<{
            id?: string;
            type?: string;
            contains?: unknown;
            not_contains?: unknown;
            equals?: number;
          }>;
        };
      };
      const byId = (id: string) => doc.expect.oracles.find((o) => o.id === id);
      expect(byId('exit0')).toEqual({ id: 'exit0', type: 'exit_code', equals: 0 });
      expect(byId('stdout-must')).toMatchObject({ type: 'stdout_assert', contains: 'tool=find' });
      expect(byId('stdout-forbid')).toMatchObject({
        type: 'stdout_assert',
        not_contains: ['rm -rf', 'secret'],
      });
    }

    // Verify READ path (getTask) returns the updated contains/notContains
    const readBack = getTask(root, 'PAIRED-TASK-84');
    expect('error' in readBack).toBe(false);
    if ('error' in readBack) return;
    expect(readBack.contains).toEqual(['tool=find']);
    expect(readBack.notContains).toEqual(['rm -rf', 'secret']);

    const preserved = await updateTask(root, root, 'PAIRED-TASK-84', {
      prompt: 'Search the repo, then seal with UPD_HIT2.',
      passToken: 'UPD_HIT2',
      changeName: '只改题干',
    });
    expect('error' in preserved).toBe(false);
    if ('error' in preserved) return;
    const offAfter = JSON.parse(readFileSync(offFile, 'utf8')) as {
      expect: {
        oracles: Array<{ id?: string; contains?: unknown; not_contains?: unknown }>;
      };
    };
    const must = offAfter.expect.oracles.find((o) => o.id === 'stdout-must');
    const forbid = offAfter.expect.oracles.find((o) => o.id === 'stdout-forbid');
    expect(must?.contains).toBe('tool=find');
    expect(forbid?.not_contains).toEqual(['rm -rf', 'secret']);

    // Verify READ path still returns preserved values after update without oracles change
    const readBack2 = getTask(root, 'PAIRED-TASK-84');
    expect('error' in readBack2).toBe(false);
    if ('error' in readBack2) return;
    expect(readBack2.contains).toEqual(['tool=find']);
    expect(readBack2.notContains).toEqual(['rm -rf', 'secret']);
  });

  it('nextCreateTaskId on empty project is PAIRED-TASK-01', () => {
    root = seedProject();
    expect(nextCreateTaskId(root)).toBe('PAIRED-TASK-01');
  });
});
