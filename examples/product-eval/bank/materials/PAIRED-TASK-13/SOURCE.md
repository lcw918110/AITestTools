# PAIRED-TASK-13 来源标注

| 项 | 内容 |
| :--- | :--- |
| 类型 | **直接改编** |
| 来源 | UK AISI Inspect AI `examples/inline_cards/approval.py`（dangerous_action + human approval demo） |
| URL | https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/examples/inline_cards/approval.py |
| 许可 | MIT（https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/LICENSE） |
| 条款摘要 | 允许复制、修改、分发；须保留版权与许可声明；软件按「原样」提供 |
| 改编说明 | 保留「危险动作须人工批准」心智；去掉 mockllm/tool 运行时，改成纯文本 OFF/ON 效果题；终态词 `APPROVE_GATE` 为本库新增 |
