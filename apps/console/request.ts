/**
 * HTTP 请求体读取与 JSON 解析（parser）。
 */
import type { IncomingMessage } from 'node:http';

/** 默认请求体字节上限：1 MiB（REQ-CONSOLE-SEC-001） */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;
  constructor(maxBytes = MAX_REQUEST_BODY_BYTES) {
    super(`payload too large (max ${maxBytes} bytes)`);
    this.name = 'RequestBodyTooLargeError';
  }
}

/** 读取请求体为 UTF-8 字符串（有界读取，超限抛出 RequestBodyTooLargeError） */
export function readBody(req: IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      req.resume();
      reject(new RequestBodyTooLargeError(maxBytes));
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    req.on('data', (c: Buffer) => {
      if (settled) return;
      totalBytes += c.length;
      if (totalBytes > maxBytes) {
        settled = true;
        req.resume();
        reject(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
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
