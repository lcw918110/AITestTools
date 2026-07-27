/**
 * OpenCode 临时 hook probe 插件（contract verify 用）。
 * 写入 PROCTOR_PROBE_LOG（ndjson），验证真宿主是否触发契约 hook。
 * 不修改用户全局配置：由 verify 在临时工作区挂载。
 */
import { appendFileSync } from 'node:fs';

function log(hook, payload) {
  const dest = process.env.PROCTOR_PROBE_LOG;
  if (!dest) return;
  const row = {
    ts: new Date().toISOString(),
    hook,
    payload: summarize(payload),
  };
  appendFileSync(dest, `${JSON.stringify(row)}\n`);
}

function summarize(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== 'object') return { value: String(payload).slice(0, 200) };
  const o = /** @type {Record<string, unknown>} */ (payload);
  const out = {};
  for (const k of Object.keys(o).slice(0, 12)) {
    const v = o[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (v && typeof v === 'object' && 'type' in /** @type {object} */ (v)) {
      out[k] = { type: /** @type {{type?: string}} */ (v).type };
    } else out[k] = typeof v;
  }
  return out;
}

/** OpenCode 工厂：只导出一个 factory（与万象术 Plugin.js 约定一致）。 */
export function plugin(_ctx) {
  return {
    event: async (input) => {
      log('event', input);
    },
    'chat.message': async (input, _output) => {
      log('chat.message', input);
    },
    'tool.execute.before': async (input, _output) => {
      log('tool.execute.before', input);
    },
    'tool.execute.after': async (input, _output) => {
      log('tool.execute.after', input);
    },
  };
}

export default plugin;
