#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AssetParseError } from '../exam-engine/loader.ts';
import { ProjectError } from '../exam-engine/project.ts';
import { runCassetteRecord } from './commands/cassette-record.ts';
import { runBaselinePin } from './commands/baseline-pin.ts';
import { runCompare } from './commands/compare.ts';
import { runContractVerify } from './commands/contract-verify.ts';
import { runInit } from './commands/init.ts';
import { runItemNew } from './commands/item-new.ts';
import { runItemValidate } from './commands/item-validate.ts';
import { runReportShow } from './commands/report-show.ts';
import { runReportTrend } from './commands/report-trend.ts';
import { runScoreWrite } from './commands/score-write.ts';
import { runCommand } from './commands/run.ts';
import { loadDotEnv } from './load-dotenv.ts';

loadDotEnv();

const HELP = `agent-proctor — 第三方独立 Agent 监考/评测引擎

用法：
  proctor init [目录]                     生成考卷库骨架
  proctor item validate [文件...]         校验试题（cases-v1）
  proctor item new --id <case_id> --mode <fold|scripted|cassette|hosted|direct_tool>
  proctor cassette record --from <trace> --id <名>
  proctor run --dataset <名> --environment <名>   cases-v1：测试集 × 运行环境组合开跑
  proctor compare --baseline <run> --candidate <run>
  proctor baseline pin --run <run> --name <别名>
  proctor score write --run <run> --item <id> --value <分> [--max 5]
  proctor report show --run <run>
  proctor report trend [--dataset <名>] [--metric <名>] [--limit N]
  proctor contract verify --host opencode@1.18.5
  proctor --version | --help

选项：
  --project <路径>     考卷库目录或 exam.json
  --check-fixtures     检查 stimulus.ref / L2 script 是否存在
  --strict / --json / --verbose / --force
  --name <名称>        init / baseline / 变更说明 / score 备注
  --id / --layer / --title / --map / --from / --contract / --script
  --mode               item new（fold|scripted|cassette|hosted|direct_tool）
  --dataset / --environment  run（cases-v1：测试集 × 运行环境组合）
  --only <试题id>      run：只跑测试集中的这些题（可重复；不写回组卷）
  --concurrency <N>    run 试题并发（默认 1；hosted 建议 1）
  --metric / --limit   report trend
  --baseline / --candidate / --run / --host
  --item / --value / --max   score write（参考分，不进硬门禁）

别名：case → item

退出码：0 通过；1 失败；2 用法错误。`;

function readVersion(): string {
  const url = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as { version: string };
  return pkg.version;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        baseline: { type: 'string' },
        candidate: { type: 'string' },
        host: { type: 'string' },
        run: { type: 'string' },
        project: { type: 'string' },
        name: { type: 'string' },
        id: { type: 'string' },
        layer: { type: 'string' },
        title: { type: 'string' },
        map: { type: 'string', multiple: true },
        from: { type: 'string' },
        contract: { type: 'string' },
        script: { type: 'string' },
        mode: { type: 'string' },
        dataset: { type: 'string' },
        environment: { type: 'string' },
        only: { type: 'string', multiple: true },
        concurrency: { type: 'string' },
        metric: { type: 'string' },
        limit: { type: 'string' },
        item: { type: 'string' },
        value: { type: 'string' },
        max: { type: 'string' },
        json: { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        'check-fixtures': { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    console.error(`用法错误：${(e as Error).message}`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.version === true) {
    console.log(readVersion());
    return 0;
  }
  const [group, ...rest] = positionals;
  if (values.help === true || group === undefined) {
    console.log(HELP);
    return group === undefined && values.help !== true ? 2 : 0;
  }

  if (group === 'init') {
    return runInit({ dir: rest[0] ?? '.', name: values.name, force: values.force === true });
  }

  if (group === 'run') {
    const dataset = values.dataset;
    const environment = values.environment;
    if (dataset === undefined || environment === undefined) {
      console.error('用法错误：proctor run 需要 --dataset 与 --environment');
      return 2;
    }
    const concRaw = values.concurrency;
    const concurrency =
      concRaw === undefined ? undefined : Math.max(1, Number.parseInt(concRaw, 10) || 1);
    return runCommand({
      project: values.project,
      json: values.json === true,
      concurrency,
      dataset,
      environment,
      ...(values.only !== undefined ? { only: values.only } : {}),
    });
  }

  if (group === 'compare') {
    const cmp: Parameters<typeof runCompare>[0] = { json: values.json === true };
    if (values.baseline !== undefined) cmp.baseline = values.baseline;
    if (values.candidate !== undefined) cmp.candidate = values.candidate;
    return runCompare(cmp);
  }

  if (group === 'score') {
    const [sub] = rest;
    if (sub !== 'write') {
      console.error(
        '用法错误：proctor score write --run <目录> --item <id> --value <分> [--max 5]',
      );
      return 2;
    }
    const scoreOpts: Parameters<typeof runScoreWrite>[0] = { json: values.json === true };
    if (values.run !== undefined) scoreOpts.run = values.run;
    const itemId = values.item ?? values.id;
    if (itemId !== undefined) scoreOpts.item = itemId;
    if (values.value !== undefined) scoreOpts.value = values.value;
    if (values.max !== undefined) scoreOpts.max = values.max;
    if (values.name !== undefined) scoreOpts.note = values.name;
    return runScoreWrite(scoreOpts);
  }

  if (group === 'contract') {
    const [sub] = rest;
    if (sub !== 'verify') {
      console.error('用法错误：proctor contract verify --host opencode@1.18.5');
      return 2;
    }
    if (values.host === undefined) {
      console.error('用法错误：需要 --host opencode@1.18.5');
      return 2;
    }
    return runContractVerify({
      host: values.host,
      project: values.project,
      json: values.json === true,
    });
  }

  if (group === 'baseline') {
    const [sub] = rest;
    if (sub !== 'pin') {
      console.error('用法错误：proctor baseline pin --run <目录> --name <别名>');
      return 2;
    }
    const pin: Parameters<typeof runBaselinePin>[0] = { json: values.json === true };
    if (values.run !== undefined) pin.run = values.run;
    if (values.name !== undefined) pin.name = values.name;
    if (values.project !== undefined) pin.project = values.project;
    return runBaselinePin(pin);
  }

  if (group === 'report') {
    const [sub] = rest;
    if (sub === 'show') {
      const show: Parameters<typeof runReportShow>[0] = { json: values.json === true };
      if (values.run !== undefined) show.run = values.run;
      return runReportShow(show);
    }
    if (sub === 'trend') {
      const limRaw = values.limit;
      const limit =
        limRaw === undefined ? undefined : Math.max(1, Number.parseInt(limRaw, 10) || 20);
      return runReportTrend({
        project: values.project,
        dataset: values.dataset,
        metric: values.metric,
        limit,
        json: values.json === true,
      });
    }
    console.error('用法错误：proctor report show|trend …');
    return 2;
  }

  if (group === 'cassette') {
    const [sub] = rest;
    if (sub !== 'record') {
      console.error('用法错误：proctor cassette record --from <trace> --id <名>');
      return 2;
    }
    return runCassetteRecord({
      project: values.project,
      from: values.from,
      id: values.id,
      name: values.name,
      contract: values.contract,
      script: values.script,
      json: values.json === true,
    });
  }

  if (group === 'item' || group === 'case') {
    const [sub, ...files] = rest;
    if (sub === undefined) {
      console.error(`用法错误：proctor ${group} 需要子命令（validate | new）`);
      return 2;
    }
    if (sub === 'new') {
      return await runItemNew({
        project: values.project,
        id: values.id,
        mode: values.mode,
        layer: values.layer,
        title: values.title,
        dataset: values.dataset,
        name: values.name,
        json: values.json === true,
      });
    }
    if (sub !== 'validate') {
      console.error(`用法错误：未知子命令 "${group} ${sub}"`);
      return 2;
    }
    return runItemValidate({
      project: values.project,
      files,
      json: values.json === true,
      strict: values.strict === true,
      checkFixtures: values['check-fixtures'] === true,
      verbose: values.verbose === true,
    });
  }

  console.error(`用法错误：未知命令 "${group}"`);
  return 2;
}

async function run(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ProjectError || e instanceof AssetParseError) {
      console.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void run();
}
