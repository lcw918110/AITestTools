/**
 * HTTP 请求体读取与 JSON 解析（parser）。
 */
import type { IncomingMessage } from 'node:http';

/** 读取请求体为 UTF-8 字符串 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export type ParseJsonBodyResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 解析请求体 JSON。
 * 空串按空对象处理；非法 JSON 返回统一错误 'invalid json'。
 */
export function parseJsonBody<T = Record<string, unknown>>(raw: string): ParseJsonBodyResult<T> {
  try {
    return { ok: true, value: JSON.parse(raw || '{}') as T };
  } catch {
    return { ok: false, error: 'invalid json' };
  }
}
