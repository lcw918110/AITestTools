/**
 * 静态文件服务：路径安全 + MIME 判断。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { safeUnder } from './bank.ts';
import { json, SECURITY_HEADERS } from './http.ts';
import { PUBLIC } from './config.ts';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
};

/** 根据文件路径后缀返回 Content-Type */
export function mimeTypeFor(filePath: string): string {
  const ext = filePath.split('.').pop() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** 安全提供 PUBLIC 目录下的静态文件（仅 GET，路径受 safeUnder 约束） */
export function serveStatic(res: ServerResponse, filePath: string): void {
  const abs = safeUnder(PUBLIC, filePath);
  if (!abs || !existsSync(abs) || statSync(abs).isDirectory()) {
    json(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'content-type': mimeTypeFor(abs), ...SECURITY_HEADERS });
  createReadStream(abs).pipe(res);
}
