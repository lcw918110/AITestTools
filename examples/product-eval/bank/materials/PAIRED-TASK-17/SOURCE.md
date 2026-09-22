# PAIRED-TASK-17 来源标注

| 项 | 内容 |
| :--- | :--- |
| 类型 | **方法论改编** |
| 启发来源 | EvalScope `general_fc` 负样本（`should_call_tool: false`）+ BFCL irrelevance 类别说明 |
| URL | https://evalscope.readthedocs.io/zh-cn/latest/best_practice/general_fc.html · https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard |
| 许可 | EvalScope / BFCL 脚手架与文档：**Apache-2.0** |
| 未直接使用 | ModelScope 预置 FC 全集题干；BFCL 全量 JSON 用例 |
| 改编说明 | 自拟编码助手工具箱 + 闲聊请求；测 Call vs Not Call；终态词 `TOOL_SKIP` |
| 交叉 | staging D-01 / E-08 / C-09 三选一，本条取 EvalScope 负样本心智 |
