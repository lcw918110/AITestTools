import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { EvalJob, FrameworkRawResult } from './types.ts';

export type PromptfooMode = 'fixture' | 'live';

export function resolvePromptfooMode(): PromptfooMode {
  if (process.env.PROCTOR_PROMPTFOO_LIVE === '1') return 'live';
  return 'fixture';
}

/**
 * promptfoo 适配器。
 * - fixture：CI / 无密钥
 * - live：调用依赖中的 promptfoo（拍板已 npm i；无真 API 不算 spike 完成）
 */
export async function runPromptfooAdapter(
  job: EvalJob,
  opts: { projectRoot: string; artifactDir?: string; mode?: PromptfooMode } = {
    projectRoot: '.',
  },
): Promise<FrameworkRawResult> {
  const mode = opts.mode ?? resolvePromptfooMode();
  if (opts.artifactDir !== undefined) {
    mkdirSync(opts.artifactDir, { recursive: true });
    writeFileSync(
      join(opts.artifactDir, 'eval-job.json'),
      `${JSON.stringify({ ...job, mode }, null, 2)}\n`,
    );
  }
  if (mode === 'live') return runLive(job, opts);
  return runFixture(job, opts.projectRoot);
}

function runFixture(job: EvalJob, projectRoot: string): FrameworkRawResult {
  const rows: FrameworkRawResult['rows'] = [];
  for (const model of job.models) {
    for (const item of job.items) {
      for (let repeat = 1; repeat <= job.repeats; repeat += 1) {
        // fixture 与 task.md 同目录（prompt_ref 的父目录），沿用 legacy_item_id 命名的 materials 目录。
        const matDir = dirname(item.prompt_ref);
        const fixturePath = join(
          projectRoot,
          matDir,
          'fixtures',
          `${sanitize(model)}.repeat${repeat}.json`,
        );
        const fallback = join(projectRoot, matDir, 'fixtures', `${sanitize(model)}.json`);
        const path = existsSync(fixturePath)
          ? fixturePath
          : existsSync(fallback)
            ? fallback
            : undefined;
        if (path === undefined) {
          rows.push({
            item_id: item.id,
            model,
            repeat,
            pass: false,
            raw: { error: `缺少 fixture：${fixturePath}` },
          });
          continue;
        }
        const doc = JSON.parse(readFileSync(path, 'utf8')) as {
          pass?: boolean;
          tool_trace?: unknown;
        };
        rows.push({
          item_id: item.id,
          model,
          repeat,
          pass: doc.pass !== false,
          tool_trace: doc.tool_trace,
          raw: { fixture: path },
        });
      }
    }
  }
  return { framework: 'promptfoo-fixture', rows };
}

export type LiveProvider = {
  apiKey: string;
  baseUrl: string;
  /** DeepSeek thinking 模式不支持 tool_choice=required，须用 auto */
  toolChoice: 'required' | 'auto';
};

/**
 * 按模型解析 OpenAI 兼容端点。
 * - LongCat-* → LONGCAT / OPENAI_*
 * - deepseek-* → DEEPSEEK_*（官方 api.deepseek.com）
 */
function resolveLiveProvider(model: string): LiveProvider {
  const m = model.toLowerCase();
  if (m.startsWith('deepseek')) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(`模型 ${model} 需要 DEEPSEEK_API_KEY（拍板：无真 API 不算 spike 完成）`);
    }
    return {
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      toolChoice: 'auto',
    };
  }
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.LONGCAT_API_KEY;
  if (!apiKey) {
    throw new Error(
      `模型 ${model} 需要 OPENAI_API_KEY 或 LONGCAT_API_KEY（拍板：无真 API 不算 spike 完成）`,
    );
  }
  return {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.longcat.chat/openai',
    toolChoice: 'required',
  };
}

/**
 * 构建 promptfoo 配置对象（纯函数，不写盘）。
 * 用 JS 对象 + JSON.stringify 序列化，避免手工字符串拼接破坏 YAML 语法。
 * JSON 是 YAML 1.2 的有效子集，promptfoo 的 YAML 解析器可直接解析。
 * 所有用户输入值（prompt / item_id / apiKey 等）自然被 JSON 正确转义，
 * 即使含 :、#、引号、换行、{、} 等特殊字符也不会破坏配置。
 */
export function buildPromptfooConfig(
  providers: Array<LiveProvider & { model: string }>,
  cases: Array<{ item_id: string; repeat: number; prompt: string }>,
): Record<string, unknown> {
  return {
    description: 'agent-proctor B-direct live spike',
    providers: providers.map((p) => ({
      id: `openai:chat:${p.model}`,
      config: {
        apiBaseUrl: p.baseUrl,
        apiKey: p.apiKey,
        temperature: 0,
        max_tokens: 512,
        tool_choice: p.toolChoice,
        tools: [
          {
            type: 'function',
            function: {
              name: 'todowrite',
              description: 'Create or update a todo list for multi-step work',
              parameters: {
                type: 'object',
                properties: {
                  todos: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        content: { type: 'string' },
                        status: { type: 'string' },
                      },
                    },
                  },
                  merge: { type: 'boolean' },
                },
                required: ['todos', 'merge'],
              },
            },
          },
        ],
      },
    })),
    prompts: ['{{prompt}}'],
    tests: cases.map((c) => ({
      description: `${c.item_id}::r${c.repeat}`,
      vars: {
        prompt: c.prompt,
        item_id: c.item_id,
        repeat: String(c.repeat),
      },
    })),
  };
}

function runLive(
  job: EvalJob,
  opts: { projectRoot: string; artifactDir?: string },
): FrameworkRawResult {
  const providers = job.models.map((model) => ({ model, ...resolveLiveProvider(model) }));

  const workDir = resolve(opts.artifactDir ?? join(opts.projectRoot, '.proctor-promptfoo'));
  mkdirSync(workDir, { recursive: true });
  const cfgPath = join(workDir, 'promptfooconfig.yaml');
  const outPath = join(workDir, 'promptfoo-results.json');

  const projectRoot = resolve(opts.projectRoot);
  const cases: Array<{ item_id: string; repeat: number; prompt: string }> = [];
  for (const item of job.items) {
    const promptPath = join(projectRoot, item.prompt_ref);
    const body = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : `Task ${item.id}`;
    const prompt = [
      'You are a coding agent. You MUST call the todowrite tool exactly once.',
      'Arguments MUST include todos (non-empty array of {id,content,status}) and merge (boolean).',
      '',
      body.trim(),
    ].join('\n');
    for (let repeat = 1; repeat <= job.repeats; repeat += 1) {
      cases.push({ item_id: item.id, repeat, prompt });
    }
  }

  const config = buildPromptfooConfig(providers, cases);
  writeFileSync(cfgPath, `${JSON.stringify(config, null, 2)}\n`);

  const pf = resolvePromptfooBin(projectRoot);
  // 多 provider 密钥已写在 promptfooconfig；env 仅保留默认兜底（首个模型）
  const primary = providers[0]!;
  const r = spawnSync(
    pf.cmd,
    [...pf.argsPrefix, 'eval', '-c', cfgPath, '-o', outPath, '--no-cache'],
    {
      encoding: 'utf8',
      cwd: workDir,
      timeout: 900_000,
      env: {
        ...process.env,
        OPENAI_API_KEY: primary.apiKey,
        OPENAI_BASE_URL: primary.baseUrl,
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  writeFileSync(
    join(workDir, 'promptfoo-spawn.json'),
    `${JSON.stringify(
      {
        cmd: pf.cmd,
        argsPrefix: pf.argsPrefix,
        status: r.status,
        stdout_head: (r.stdout || '').slice(0, 4000),
        stderr_head: (r.stderr || '').slice(0, 4000),
      },
      null,
      2,
    )}\n`,
  );

  if (!existsSync(outPath)) {
    throw new Error(
      `promptfoo 未产出结果（status=${String(r.status)}）：${(r.stderr || r.stdout || '').slice(0, 800)}`,
    );
  }
  return parsePromptfooOutput(outPath, job);
}

function resolvePromptfooBin(projectRoot: string): { cmd: string; argsPrefix: string[] } {
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1] ?? 0);
  // promptfoo engines: ^20.20 || >=22.22 —— 满足则走标准 CLI
  const nodeOk =
    (major === 20 && minor >= 20) || major > 22 || (major === 22 && minor >= 22) || major >= 24;
  if (nodeOk) {
    const bin = join(projectRoot, 'node_modules', '.bin', 'promptfoo');
    if (existsSync(bin)) return { cmd: bin, argsPrefix: [] };
    return { cmd: 'promptfoo', argsPrefix: [] };
  }

  const candidates = [
    join(projectRoot, 'node_modules', 'promptfoo', 'dist', 'src', 'main.js'),
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../node_modules/promptfoo/dist/src/main.js',
    ),
  ];
  for (const mainJs of candidates) {
    if (existsSync(mainJs)) {
      // Node 不满足 engines 时绕过 entrypoint（本机曾用 22.16）
      return { cmd: process.execPath, argsPrefix: [mainJs] };
    }
  }
  return { cmd: 'promptfoo', argsPrefix: [] };
}

function parsePromptfooOutput(outPath: string, job: EvalJob): FrameworkRawResult {
  const raw = JSON.parse(readFileSync(outPath, 'utf8')) as unknown;
  const rows: FrameworkRawResult['rows'] = [];
  for (const row of extractResults(raw)) {
    const vars = (row.vars ?? {}) as Record<string, unknown>;
    const itemId = String(vars.item_id ?? row.item_id ?? 'unknown');
    const providerField = row.provider;
    const providerId =
      typeof providerField === 'string'
        ? providerField
        : typeof providerField === 'object' &&
            providerField !== null &&
            typeof (providerField as { id?: unknown }).id === 'string'
          ? String((providerField as { id: string }).id)
          : String(job.models[0] ?? 'unknown');
    const model = stripProviderPrefix(providerId);
    const repeat = Number(vars.repeat ?? row.repeat ?? 1);
    const calls = extractToolCalls(row);
    const hasTodo = calls.some((c) => c.name.toLowerCase() === 'todowrite');
    rows.push({
      item_id: itemId,
      model,
      repeat,
      pass: hasTodo,
      tool_trace: calls,
      raw: row,
    });
  }
  if (rows.length === 0) {
    for (const model of job.models) {
      for (const item of job.items) {
        for (let repeat = 1; repeat <= job.repeats; repeat += 1) {
          rows.push({
            item_id: item.id,
            model,
            repeat,
            pass: false,
            raw: { error: 'promptfoo 结果无法解析', outPath },
          });
        }
      }
    }
  }
  return { framework: 'promptfoo', rows };
}

function extractResults(
  raw: unknown,
): Array<Record<string, unknown> & { vars?: Record<string, unknown> }> {
  if (Array.isArray(raw)) {
    return raw as Array<Record<string, unknown> & { vars?: Record<string, unknown> }>;
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.results)) {
      return o.results as Array<Record<string, unknown> & { vars?: Record<string, unknown> }>;
    }
    // promptfoo 新版：{ results: { results: [...] } }
    if (o.results && typeof o.results === 'object') {
      const inner = o.results as Record<string, unknown>;
      if (Array.isArray(inner.results)) {
        return inner.results as Array<Record<string, unknown> & { vars?: Record<string, unknown> }>;
      }
    }
  }
  return [];
}

function extractToolCalls(
  row: Record<string, unknown>,
): Array<{ name: string; args: Record<string, unknown> }> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const response = row.response as Record<string, unknown> | undefined;
  for (const c of [row.output, response?.output, response?.raw, row.raw, response]) {
    collectCalls(c, calls);
  }
  // provider 可能是对象
  if (row.provider && typeof row.provider === 'object') {
    const p = row.provider as Record<string, unknown>;
    if (typeof p.id === 'string') row.provider = p.id;
  }
  return calls;
}

function collectCalls(
  node: unknown,
  out: Array<{ name: string; args: Record<string, unknown> }>,
): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    try {
      collectCalls(JSON.parse(node), out);
    } catch {
      /* ignore */
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectCalls(x, out);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;

  // OpenAI tool_calls 形：{ type:'function', function:{ name, arguments } }
  if (o.function && typeof o.function === 'object') {
    const fn = o.function as Record<string, unknown>;
    if (typeof fn.name === 'string') {
      let args: Record<string, unknown> = {};
      const a = fn.arguments ?? fn.args;
      if (typeof a === 'string') {
        try {
          args = JSON.parse(a) as Record<string, unknown>;
        } catch {
          args = { raw: a };
        }
      } else if (a && typeof a === 'object') {
        args = a as Record<string, unknown>;
      }
      out.push({ name: fn.name, args });
    }
  }

  if (typeof o.name === 'string' && (o.arguments !== undefined || o.args !== undefined)) {
    let args: Record<string, unknown> = {};
    const a = o.arguments ?? o.args;
    if (typeof a === 'string') {
      try {
        args = JSON.parse(a) as Record<string, unknown>;
      } catch {
        args = { raw: a };
      }
    } else if (a && typeof a === 'object') {
      args = a as Record<string, unknown>;
    }
    out.push({ name: o.name, args });
  }
  if (Array.isArray(o.tool_calls)) collectCalls(o.tool_calls, out);
  if (o.message) collectCalls(o.message, out);
  if (o.choices) collectCalls(o.choices, out);
}

function stripProviderPrefix(model: string): string {
  return model.replace(/^openai:chat:/, '').replace(/^openai:/, '');
}

function sanitize(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, '_');
}
