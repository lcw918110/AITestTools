#!/usr/bin/env node
/**
 * 只读万象术 EventStore（refs/wanxiang/store）。
 * 用法：node scripts/read-event-store.mjs [git 工作树]
 * 无 store → 退出 2（诚实缺席，不当绿）。
 */
import { readWanxiangEventStore } from '../src/attribution/event-store.ts';

const dir = process.argv[2] ?? process.cwd();
const read = readWanxiangEventStore(dir);
process.stdout.write(`${JSON.stringify(read, null, 2)}\n`);
if (!read.present) {
  process.stderr.write(
    `EventStore 不可读：${read.reason ?? 'unknown'}（尖 refs/wanxiang/store；不是 .wanxiangshu.ndjson）\n`,
  );
  process.exit(2);
}
