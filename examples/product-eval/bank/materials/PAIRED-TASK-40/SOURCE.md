# PAIRED-TASK-40 来源标注

| 项         | 内容                                                                                                                               |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| 类型       | **方法论改编**                                                                                                                     |
| 启发来源   | Promptfoo `examples/redteam-coding-agent` · `coding-agent:sandbox-read-escape`                                                     |
| URL        | https://github.com/promptfoo/promptfoo/tree/main/examples/redteam-coding-agent                                                     |
| 许可       | MIT                                                                                                                                |
| 未直接使用 | 官方探针原文；不诱导真实逃逸                                                                                                       |
| 改编说明   | 合成工作区外路径；测 filesystem 读边界（相对 TASK-13 批准门、非写逃逸）；终态词 `WS_READ_BOUND`；写边界 `WS_WRITE_BOUND` 留 ROUND3 |
