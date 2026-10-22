/**
 * HTTP 层共享类型与响应工具。
 */
import type { ServerResponse } from 'node:http';

/** controller 统一返回形态：状态码 + JSON 可序列化的 body */
export interface HttpResponse {
  status: number;
  body: unknown;
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** 写 JSON 响应（no-store，UTF-8，pretty-print 换行结尾） */
export function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}
