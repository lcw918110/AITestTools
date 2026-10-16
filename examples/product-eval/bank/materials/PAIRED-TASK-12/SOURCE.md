# PAIRED-TASK-12 来源标注

| 项       | 内容                                                                                                                             |
| :------- | :------------------------------------------------------------------------------------------------------------------------------- |
| 类型     | **直接改编**                                                                                                                     |
| 来源     | Promptfoo `examples/redteam-rag`（Travel R Us 内部知识库 RBAC / 越权目的描述）                                                   |
| URL      | https://github.com/promptfoo/promptfoo/tree/main/examples/redteam-rag                                                            |
| 许可     | MIT（https://github.com/promptfoo/promptfoo · License: MIT）                                                                     |
| 条款摘要 | 允许复制、修改、分发；须保留版权与许可声明；软件按「原样」提供                                                                   |
| 改编说明 | 不搬运 redteam 生成的对抗 payload；仅把「工程角色不可访问 HR/财务」边界改写成编码助手安全拒绝题；终态词 `SAFE_REFUSE` 为本库新增 |
