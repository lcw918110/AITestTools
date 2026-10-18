import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseRevisions, loadCasesV2, loadEnvironments } from '../../src/exam-engine/loader.ts';
import { caseRevisionToItemDoc, environmentToRoom } from '../../src/run/cases-v1-adapter.ts';

const demoRoot = join(process.cwd(), 'examples', 'demo-project');
const wxRoot = join(process.cwd(), 'examples', 'wanxiangshu-papers');

describe('cases-v1 适配层（阶段 6：A/C 轴执行驱动还原）', () => {
  it('A 轴 L1 fold 题还原 FreezeA（fold_entry/event_schema/session_id）', () => {
    const cases = loadCasesV2(join(wxRoot, 'cases'), wxRoot);
    const revisions = loadCaseRevisions(join(wxRoot, 'case-revisions'), wxRoot);

    const caseDoc = cases.find((c) => c.doc.case_id === 'wx-a-st-01-main')!.doc;
    const rev = revisions.find((r) => r.doc.case_revision_id === 'wx-a-st-01-main.r1')!.doc;

    const item = caseRevisionToItemDoc(rev, caseDoc);

    expect(item.axis).toBe('A');
    expect(item.id).toBe('WX-A-ST-01-MAIN');
    const freeze = item.freeze as {
      layer: string;
      fold_entry?: string;
      event_schema?: string;
      session_id?: string;
    };
    expect(freeze.layer).toBe('L1');
    expect(freeze.fold_entry).toBe('squad-dag');
    expect(freeze.event_schema).toBe('wanxiangshu-ndjson-v1');
    expect(freeze.session_id).toBe('st-01');
  });

  it('A 轴 L2 scripted 题还原 FreezeA（contract/script）', () => {
    const cases = loadCasesV2(join(demoRoot, 'cases'), demoRoot);
    const revisions = loadCaseRevisions(join(demoRoot, 'case-revisions'), demoRoot);

    const caseDoc = cases.find((c) => c.doc.case_id === 'demo-a-review-pass-01')!.doc;
    const rev = revisions.find((r) => r.doc.case_revision_id === 'demo-a-review-pass-01.r1')!.doc;

    const item = caseRevisionToItemDoc(rev, caseDoc);

    expect(item.axis).toBe('A');
    const freeze = item.freeze as {
      layer: string;
      contract?: string;
      script?: string;
      model_driver: string;
    };
    expect(freeze.layer).toBe('L2');
    expect(freeze.contract).toBe('demo-host-v1');
    expect(freeze.script).toBe('scripts/review-pass-v1.json');
    expect(freeze.model_driver).toBe('scripted');
  });

  it('C 轴 direct_tool 题还原 axis=C', () => {
    const cases = loadCasesV2(join(wxRoot, 'cases'), wxRoot);
    const revisions = loadCaseRevisions(join(wxRoot, 'case-revisions'), wxRoot);

    const caseDoc = cases.find((c) => c.doc.case_id === 'wx-c-st-06-rebase')!.doc;
    const rev = revisions.find((r) => r.doc.case_revision_id === 'wx-c-st-06-rebase.r1')!.doc;

    const item = caseRevisionToItemDoc(rev, caseDoc);

    expect(item.axis).toBe('C');
  });

  it('fold 环境还原 RoomDoc.kind=fold + fold_entries', () => {
    const envs = loadEnvironments(join(wxRoot, 'environments'), wxRoot);
    const env = envs.find((e) => e.doc.environment_profile_id === 'fold-wanxiangshu-v1')!.doc;

    const room = environmentToRoom(env);

    expect(room.kind).toBe('fold');
    expect(room.model_driver).toBe('none');
    expect(room.fold_entries).toBeDefined();
    expect(room.fold_entries?.['squad-dag']?.module).toBe('adapters/fold-bridge.mjs');
  });

  it('fake-host 环境还原 RoomDoc.kind=fake-host + adapter', () => {
    const envs = loadEnvironments(join(wxRoot, 'environments'), wxRoot);
    const env = envs.find((e) => e.doc.environment_profile_id === 'fake-host-opencode-v1')!.doc;

    const room = environmentToRoom(env);

    expect(room.kind).toBe('fake-host');
    expect(room.adapter?.framework).toBe('wanxiangshu-l2-shim');
    expect(room.adapter?.hook_style).toBe('opencode-v1');
  });

  it('hosted 环境仍还原 kind=hosted（product-eval 不回归）', () => {
    const envs = loadEnvironments(
      join(process.cwd(), 'examples', 'product-eval', 'environments'),
      join(process.cwd(), 'examples', 'product-eval'),
    );
    const env = envs.find((e) => e.doc.environment_profile_id === 'hosted-plugin-v1')!.doc;

    const room = environmentToRoom(env);

    expect(room.kind).toBe('hosted');
    expect(room.host?.plugin).toBe(env.recipe.host_plugin);
  });
});
