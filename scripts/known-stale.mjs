#!/usr/bin/env node
/**
 * 已知失效 smoke：退出 2，不当健康信号。
 * 用法：node scripts/known-stale.mjs coordinator
 */
const REASONS = {
  coordinator: `已知失效：Coordinator HTTP / 万象阵。
PluginWanxiangzhen 已从万象术移除；st-coordinator-e2e 不再当绿。`,
};

const key = process.argv[2] ?? '';
const reason = REASONS[key];
if (!reason) {
  process.stderr.write(
    `未知失效项：${key || '(空)'}（支持：${Object.keys(REASONS).join(', ')}）\n`,
  );
  process.exit(2);
}
process.stderr.write(`${reason}\n`);
process.exit(2);
