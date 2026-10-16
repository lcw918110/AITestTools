/**
 * 控制台 JSON/文本落盘的原子写工具。
 * 原子性：先写同目录临时文件，成功后再 renameSync 覆盖目标，
 * 避免直写覆盖时并发读者读到半截文件。收敛控制台各 JSON 写点。
 */
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 同进程递增序号，配合 pid 与时间戳保证临时文件唯一。 */
let tmpSeq = 0;

/** 生成与目标同目录的临时文件路径（rename 跨文件系统会失去原子性，故必须同目录）。 */
function tmpPathFor(target: string): string {
  const id = `${process.pid}-${Date.now().toString(36)}-${(tmpSeq++).toString(36)}`;
  return join(dirname(target), `.${id}.tmp`);
}

/** 原子写入文本：先写同目录临时文件，成功后再 renameSync 覆盖目标；失败时清理临时文件。 */
export function writeTextAtomic(target: string, text: string): void {
  const tmp = tmpPathFor(target);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, target);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* 临时文件清理失败可忽略 */
    }
    throw e;
  }
}

/** 原子写入 JSON：序列化失败时附加目标路径上下文；成功后走原子写。 */
export function writeJsonAtomic(target: string, doc: unknown): void {
  let text: string;
  try {
    text = `${JSON.stringify(doc, null, 2)}\n`;
  } catch (e) {
    throw new Error(`JSON 序列化失败（${target}）：${(e as Error).message}`);
  }
  writeTextAtomic(target, text);
}

/**
 * 带 CAS 的原子 JSON 写入：写前比对目标文件 mtime 与期望值。
 * 不一致说明读后被并发修改，拒绝覆盖并返回 false；一致则原子写并返回 true。
 * 用于 PUT /api/env/rooms/:name 的读-改-写 TOCTOU 竞态防护。
 * 基于文件系统真实 mtime（毫秒级、纳秒精度），比进程内存时间戳映射更强：
 * 连进程外对文件的修改也能检测到。
 */
export function writeJsonAtomicCas(target: string, doc: unknown, expectedMtimeMs: number): boolean {
  if (statSync(target).mtimeMs !== expectedMtimeMs) return false;
  writeJsonAtomic(target, doc);
  return true;
}
