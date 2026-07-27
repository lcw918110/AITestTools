import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject } from '../../exam-engine/project.ts';

export interface ItemNewOptions {
  project?: string | undefined;
  id?: string | undefined;
  axis?: string | undefined;
  layer?: string | undefined;
  title?: string | undefined;
  name?: string | undefined;
  json: boolean;
}

/**
 * 生成 draft 试题骨架 + materials 目录。
 * 不自动进 paperset——由人工挂卷。
 */
export function runItemNew(options: ItemNewOptions): number {
  if (options.id === undefined || options.axis === undefined) {
    console.error(
      '用法：proctor item new --id <ID> --axis <A|B|C> [--layer L1|L2|L3] [--title ...] [--project ...]',
    );
    return 2;
  }
  if (!/^[A-Z]+[A-Z0-9-]*$/.test(options.id)) {
    console.error('试题 id 须匹配 ^[A-Z]+[A-Z0-9-]*$');
    return 2;
  }
  const axis = options.axis.toUpperCase();
  if (!['A', 'B', 'C'].includes(axis)) {
    console.error('本命令 --axis 仅支持 A / B / C');
    return 2;
  }

  const project = loadProject(options.project);
  const layer = options.layer?.toUpperCase();
  const sub =
    axis === 'A' && layer !== undefined ? `A` : axis === 'B' ? 'B' : axis === 'C' ? 'C' : axis;
  const file = join(
    project.dirs.items,
    sub,
    `${options.id.toLowerCase().replace(/_/g, '-')}.item.json`,
  );
  if (existsSync(file)) {
    console.error(`已存在：${file}`);
    return 1;
  }

  const title = options.title ?? options.name ?? `${options.id}（draft）`;
  const freeze: Record<string, unknown> =
    axis === 'A' && layer === 'L1'
      ? { layer: 'L1', fold_entry: 'TODO', model_driver: 'none' }
      : axis === 'A' && layer === 'L2'
        ? {
            layer: 'L2',
            model_driver: 'scripted',
            contract: 'TODO',
            script: 'scripts/TODO.json',
          }
        : axis === 'A' && layer === 'L3'
          ? {
              layer: 'L3',
              model_driver: 'as-recorded',
              contract: 'TODO',
              cassette: 'cassettes/TODO/manifest.json',
            }
          : axis === 'C'
            ? {
                model_driver: 'none',
                model_id: 'n/a',
                host_profile: 'TODO',
                tool_profile: 'TODO',
                prompt_template: 'n/a',
              }
            : {
                model_driver: 'promptfoo',
                model_id: 'TODO',
                host_profile: 'TODO',
                tool_profile: 'TODO',
                prompt_template: 'TODO',
              };

  const stimulusKind =
    axis === 'A' && layer === 'L1'
      ? 'event_sequence'
      : axis === 'A' && layer === 'L3'
        ? 'cassette'
        : axis === 'C'
          ? 'tool_args'
          : 'hook_script';

  const matDir = join(project.root, 'materials', options.id);
  mkdirSync(matDir, { recursive: true });
  mkdirSync(join(project.dirs.items, sub), { recursive: true });

  const stimRef =
    stimulusKind === 'cassette'
      ? String(freeze.cassette)
      : stimulusKind === 'event_sequence'
        ? `materials/${options.id}/stimulus.ndjson`
        : `materials/${options.id}/stimulus.json`;

  if (stimulusKind === 'event_sequence') {
    writeFileSync(join(matDir, 'stimulus.ndjson'), '');
    writeFileSync(join(matDir, 'expected-fold.json'), '{}\n');
  } else if (stimulusKind !== 'cassette') {
    writeFileSync(join(matDir, 'stimulus.json'), '{}\n');
  }

  const doc = {
    id: options.id,
    rev: 1,
    axis,
    status: 'draft',
    title,
    owner: 'local',
    tags: ['draft'],
    intent: {
      statement: 'TODO：填写可证伪意图',
      attribution_focus: axis === 'C' ? 'TOOL' : 'PROTOCOL',
    },
    freeze,
    stimulus: { kind: stimulusKind, ref: stimRef },
    expect: {
      oracles:
        axis === 'A' && layer === 'L1'
          ? [{ id: 'fold', type: 'event_fold', spec: `materials/${options.id}/expected-fold.json` }]
          : [{ id: 'todo', type: 'exit_code', equals: 0 }],
    },
    metrics: { primary: ['a_case_pass_rate'] },
    execution: { deadline_ms: 15000, requires_network: false },
    change_log: { rev1: 'proctor item new 骨架' },
  };

  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  const out = { file, id: options.id, status: 'draft' };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`已创建 draft：${options.id} → ${file}`);
  return 0;
}
