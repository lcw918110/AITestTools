/**
 * 控制台服务全局路径与常量。
 * 仅提供常量；不在 import 时产生目录创建、端口监听等副作用。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, '../..');
export const PUBLIC = join(__dirname, 'public');
export const PROJECT = process.env.PROCTOR_CONSOLE_PROJECT
  ? resolve(process.env.PROCTOR_CONSOLE_PROJECT)
  : join(REPO_ROOT, 'examples/product-eval');
export const DEFAULT_JOBS_DIR = join(__dirname, '.jobs');
export const JOBS_DIR = process.env.PROCTOR_CONSOLE_JOBS_DIR
  ? resolve(process.env.PROCTOR_CONSOLE_JOBS_DIR)
  : DEFAULT_JOBS_DIR;
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.PROCTOR_CONSOLE_PORT ?? 8787);
