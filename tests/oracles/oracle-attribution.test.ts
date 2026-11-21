/**
 * 纯逻辑 oracle 的归因分支回归。
 *
 * 这些分支决定「失败算谁的」：试卷配错 / 期望文件读不到必须归 `HARNESS`（不进被测结论），
 * 被测输出不符才是 `PROTOCOL` 或显式指定的焦点归因。归因一旦漂移，
 * 报告会把工装问题记成被测缺陷（或反过来把被测缺陷洗成环境问题），因此逐条锁死。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runEventFoldOracle } from '../../src/oracles/event-fold.ts';
import { runStatePredicateOracle } from '../../src/oracles/state-predicate-oracle.ts';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('runEventFoldOracle：期望折叠态读取与比对', () => {
  it('期望文件读不到 → 判负且归 HARNESS（试卷问题，不进被测结论）', () => {
    root = mkdtempSync(join(tmpdir(), 'fold-oracle-'));
    const out = runEventFoldOracle({
      oracle_id: 'f1',
      foldState: {},
      expectedPath: 'missing.json',
      projectRoot: root,
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('期望文件缺失不应判通过');
    expect(out.attribution).toBe('HARNESS');
    expect(out.message).toContain('无法读取期望折叠态');
  });

  it('期望文件不是合法 JSON → 同样归 HARNESS', () => {
    root = mkdtempSync(join(tmpdir(), 'fold-oracle-'));
    writeFileSync(join(root, 'bad.json'), '{ not json');
    const out = runEventFoldOracle({
      oracle_id: 'f1',
      foldState: {},
      expectedPath: 'bad.json',
      projectRoot: root,
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('非法 JSON 期望文件不应判通过');
    expect(out.attribution).toBe('HARNESS');
  });

  it('折叠态一致 → 通过', () => {
    root = mkdtempSync(join(tmpdir(), 'fold-oracle-'));
    writeFileSync(join(root, 'exp.json'), JSON.stringify({ a: 1 }));
    const out = runEventFoldOracle({
      oracle_id: 'f1',
      foldState: { a: 1 },
      expectedPath: 'exp.json',
      projectRoot: root,
    });
    expect(out.pass).toBe(true);
  });

  it('不一致 → PROTOCOL，并带上证据引用', () => {
    root = mkdtempSync(join(tmpdir(), 'fold-oracle-'));
    writeFileSync(join(root, 'exp.json'), JSON.stringify({ a: 1 }));
    const out = runEventFoldOracle({
      oracle_id: 'f1',
      foldState: { a: 2 },
      expectedPath: 'exp.json',
      projectRoot: root,
      artifactRel: 'raw/fold.json',
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('折叠态不一致不应判通过');
    expect(out.attribution).toBe('PROTOCOL');
    expect(out.evidence_ref).toBe('raw/fold.json');
  });

  it('显式焦点归因覆盖默认 PROTOCOL', () => {
    root = mkdtempSync(join(tmpdir(), 'fold-oracle-'));
    writeFileSync(join(root, 'exp.json'), JSON.stringify({ a: 1 }));
    const out = runEventFoldOracle({
      oracle_id: 'f1',
      foldState: { a: 2 },
      expectedPath: 'exp.json',
      projectRoot: root,
      attribution: 'MODEL_TASK',
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('折叠态不一致不应判通过');
    expect(out.attribution).toBe('MODEL_TASK');
  });
});

describe('runStatePredicateOracle：谓词求值与求值错误', () => {
  it('谓词为真 → 通过', () => {
    const out = runStatePredicateOracle({
      oracle_id: 'p1',
      expr: 'count == 2',
      root: { count: 2 },
    });
    expect(out.pass).toBe(true);
  });

  it('谓词为假 → PROTOCOL，并带证据引用', () => {
    const out = runStatePredicateOracle({
      oracle_id: 'p1',
      expr: 'count == 3',
      root: { count: 2 },
      evidence_ref: 'raw/events.json',
    });
    expect(out.pass).toBe(false);
    if (out.pass) throw new Error('谓词为假不应判通过');
    expect(out.attribution).toBe('PROTOCOL');
    expect(out.evidence_ref).toBe('raw/events.json');
  });

  it('谓词求值异常 → 归 HARNESS 而不是被测失败', () => {
    const out = runStatePredicateOracle({
      oracle_id: 'p1',
      expr: 'this is not a predicate !!',
      root: {},
    });
    // 先做类型收窄断言，再断言归因与消息，避免「通过态也当失败态检查」
    if (out.pass) throw new Error('谓词求值异常不应判通过');
    expect(out.attribution).toBe('HARNESS');
    expect(out.message).toContain('predicate error');
  });
});
