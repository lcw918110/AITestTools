/**
 * OpenCode cassette 录制插件（真宿主 hook 面）。
 *
 * 环境变量：
 * - PROCTOR_CASSETTE_JOURNAL：journal.ndjson 绝对路径（必填才会写）
 * - PROCTOR_CASSETTE_ID：可选，写入每行便于多盘区分
 *
 * 与 contract verify 的 probe 同形：只观察，不改工具结果。
 * 落盘字段对齐 L3 cassette：hook 名 + 精简 payload（event.type / tool）。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function journalPath() {
  return process.env.PROCTOR_CASSETTE_JOURNAL;
}

function summarize(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== 'object') return { value: String(payload).slice(0, 200) };
  const o = /** @type {Record<string, unknown>} */ (payload);
  const out = /** @type {Record<string, unknown>} */ ({});
  for (const k of Object.keys(o).slice(0, 16)) {
    const v = o[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    } else if (v && typeof v === 'object') {
      const obj = /** @type {Record<string, unknown>} */ (v);
      if (typeof obj.type === 'string') out[k] = { type: obj.type };
      else if (typeof obj.name === 'string') out[k] = { name: obj.name };
      else out[k] = typeof v;
    } else out[k] = typeof v;
  }
  return out;
}

function append(hook, payload) {
  const dest = journalPath();
  if (!dest) return;
  mkdirSync(dirname(dest), { recursive: true });
  const row = {
    ts: new Date().toISOString(),
    hook,
    cassette_id: process.env.PROCTOR_CASSETTE_ID ?? null,
    payload: summarize(payload),
  };
  appendFileSync(dest, `${JSON.stringify(row)}\n`);
}

/** OpenCode 工厂（与 probe / 万象术 Plugin 约定一致）。 */
export function plugin(_ctx) {
  return {
    event: async (input) => {
      append('event', input);
    },
    'chat.message': async (input, _output) => {
      append('chat.message', input);
    },
    'tool.execute.before': async (input, _output) => {
      append('tool.execute.before', input);
    },
    'tool.execute.after': async (input, _output) => {
      append('tool.execute.after', input);
    },
  };
}

export default plugin;
