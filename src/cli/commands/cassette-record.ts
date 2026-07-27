import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJournal, sealJournalToManifestFields } from '../../drivers/cassette/journal.ts';
import { loadProject } from '../../exam-engine/project.ts';

export interface CassetteRecordOptions {
  project?: string | undefined;
  /** artifacts / journal.ndjson / l3-trace.json */
  from?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  contract?: string | undefined;
  script?: string | undefined;
  json: boolean;
}

/**
 * 生成 cassette：
 * - 自 l3-trace / timeline（离线 scripted）
 * - 自 OpenCode recorder 的 journal.ndjson（journal 回放）
 */
export function runCassetteRecord(options: CassetteRecordOptions): number {
  if (options.from === undefined || options.id === undefined) {
    console.error(
      '用法：proctor cassette record --from <artifacts|journal.ndjson|trace.json> --id <id> [--project ...] [--contract ...] [--script ...]',
    );
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.id)) {
    console.error('cassette id 须为字母数字与 ._ -');
    return 2;
  }

  const project = loadProject(options.project);
  const from = resolve(options.from);
  const outDir = join(project.root, 'cassettes', options.id);
  mkdirSync(outDir, { recursive: true });

  const journalCandidate = existsSync(join(from, 'journal.ndjson'))
    ? join(from, 'journal.ndjson')
    : from.endsWith('journal.ndjson')
      ? from
      : undefined;

  if (journalCandidate !== undefined && existsSync(journalCandidate)) {
    return sealJournal({
      projectRoot: project.root,
      outDir,
      id: options.id,
      journalPath: journalCandidate,
      contract: options.contract,
      name: options.name,
      json: options.json,
    });
  }

  let tracePath = from;
  if (existsSync(join(from, 'l3-trace.json'))) tracePath = join(from, 'l3-trace.json');
  else if (existsSync(join(from, 'timeline.json'))) tracePath = join(from, 'timeline.json');
  else if (!from.endsWith('.json') || !existsSync(from)) {
    console.error(`找不到输入：${from}（需要 journal.ndjson / l3-trace.json / timeline.json）`);
    return 1;
  }

  const raw = JSON.parse(readFileSync(tracePath, 'utf8')) as {
    hooks?: string[];
    timeline?: Array<{ type?: string }>;
    events?: Array<{ type?: string }>;
  };

  const hooks = Array.isArray(raw.hooks) ? raw.hooks.map(String) : [];
  const timeline = Array.isArray(raw.timeline)
    ? raw.timeline
    : Array.isArray(raw.events)
      ? raw.events
      : [];
  const expectedEvents = timeline
    .map((e) => (typeof e.type === 'string' ? e.type : undefined))
    .filter((t): t is string => t !== undefined);

  const uniqHooks: string[] = [];
  for (const h of hooks) {
    if (uniqHooks[uniqHooks.length - 1] !== h) uniqHooks.push(h);
  }
  const uniqEvents: string[] = [];
  for (const e of expectedEvents) {
    if (uniqEvents[uniqEvents.length - 1] !== e) uniqEvents.push(e);
  }

  const manifest = {
    id: options.id,
    rev: 1,
    replay_mode: 'scripted' as const,
    host: 'recorded',
    host_version: '0.0.0',
    contract: options.contract ?? 'demo-host-v1',
    script: options.script,
    expected_hooks: uniqHooks,
    expected_events: uniqEvents,
    source_trace: basename(tracePath),
    note: options.name ?? 'proctor cassette record（离线 trace）',
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, 'source-trace.json'), `${JSON.stringify(raw, null, 2)}\n`);

  const out = {
    cassette: options.id,
    mode: 'scripted',
    manifest: manifestPath,
    hooks: uniqHooks.length,
    events: uniqEvents.length,
  };
  if (options.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`已录制 cassette（scripted）：${options.id} → ${manifestPath}`);
  return 0;
}

function sealJournal(opts: {
  projectRoot: string;
  outDir: string;
  id: string;
  journalPath: string;
  contract?: string | undefined;
  name?: string | undefined;
  json: boolean;
}): number {
  const destJournal = join(opts.outDir, 'journal.ndjson');
  if (resolve(opts.journalPath) !== resolve(destJournal)) {
    copyFileSync(opts.journalPath, destJournal);
  }
  const rel = `cassettes/${opts.id}/journal.ndjson`;
  const sealed = sealJournalToManifestFields(loadJournal(opts.projectRoot, rel));

  const manifest = {
    id: opts.id,
    rev: 1,
    replay_mode: 'journal' as const,
    host: 'opencode',
    host_version: 'recorded',
    contract: opts.contract ?? 'opencode-v1.18',
    journal_ref: rel,
    expected_hooks: sealed.expected_hooks,
    expected_events: sealed.expected_events,
    note: opts.name ?? 'proctor cassette record（OpenCode journal）',
    recorder_plugin: 'src/drivers/cassette/recorder-plugin.mjs',
  };
  const manifestPath = join(opts.outDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const out = {
    cassette: opts.id,
    mode: 'journal',
    manifest: manifestPath,
    hooks: sealed.expected_hooks.length,
    events: sealed.expected_events.length,
    recorder: fileURLToPath(new URL('../../drivers/cassette/recorder-plugin.mjs', import.meta.url)),
  };
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`已封装 cassette（journal）：${opts.id} → ${manifestPath}`);
  return 0;
}
