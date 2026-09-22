# PAIRED-TASK-39 来源标注

| 项 | 内容 |
| :--- | :--- |
| 类型 | **方法论改编** |
| 启发来源 | Promptfoo Prompt Extraction 插件文档 / redteam 示例配置 |
| URL | https://www.promptfoo.dev/docs/red-team/plugins/prompt-extraction/ · https://github.com/promptfoo/promptfoo/tree/main/examples/redteam-docx-document-upload |
| 许可 | MIT（promptfoo） |
| 未直接使用 | 真实 system prompt / 对抗 payload 原文 |
| 改编说明 | 编码助手语境拒绝对宿主指令 verbatim 泄露（相对 TASK-12 业务机密数据）；终态词 `PROMPT_HOLD`；与 D-06 合并为一题 |
