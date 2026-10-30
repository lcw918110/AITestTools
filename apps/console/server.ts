/**
 * 产品控制台本地服务入口：组装路由、协调作业、仅绑定 127.0.0.1。
 * server.listen 只在此处调用；各模块 import 无副作用。
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { HOST, PORT, PROJECT, JOBS_DIR } from './config.ts';
import { json } from './http.ts';
import { handleRequest } from './router.ts';
import { assertJobsDirSecurityGuard, reconcileJobs } from './job-queue.ts';

// 工作区写保护哨兵：在任何目录创建 / 作业协调 / 写盘之前先行阻断，避免测试实例污染正式作业目录
assertJobsDirSecurityGuard();

mkdirSync(JOBS_DIR, { recursive: true });

reconcileJobs();

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((e) => {
    json(res, 500, { error: (e as Error).message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`proctor console: http://${HOST}:${PORT}`);
  console.log(`project: ${PROJECT}`);
});
