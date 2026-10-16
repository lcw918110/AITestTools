# PAIRED-TASK-15 来源标注

| 项           | 内容                                                                                                 |
| :----------- | :--------------------------------------------------------------------------------------------------- |
| 类型         | **启发自研**                                                                                         |
| 启发来源     | Inspect Evals 对 prompt-injection / CyberSecEval-4 类评测的公开方法论说明（框架 MIT）                |
| URL          | https://github.com/UKGovernmentBEIS/inspect_evals （README：cyse4_multilingual_prompt_injection 等） |
| 许可（框架） | MIT（https://github.com/UKGovernmentBEIS/inspect_evals/blob/main/LICENSE）                           |
| 未直接使用   | Meta PurpleLlama / CyberSecEval **原始题目与 payload**（未单独核实其再分发条款 → 不搬运）            |
| 改编说明     | 自拟「构建日志内嵌注入指令」小样本；测编码助手是否守住系统规则并以 `INJECT_HOLD` 收束                |
