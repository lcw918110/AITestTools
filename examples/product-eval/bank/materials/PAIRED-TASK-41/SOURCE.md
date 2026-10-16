# PAIRED-TASK-41 来源标注

| 项         | 内容                                                                                                                        |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------- |
| 类型       | **方法论改编**                                                                                                              |
| 启发来源   | Berkeley Function-Calling Leaderboard（BFCL）Relevance Detection 公开说明                                                   |
| URL        | https://gorilla.cs.berkeley.edu/leaderboard.html（BFCL；方法论）                                                            |
| 许可       | Apache-2.0（方法论；不搬 BFCL JSON 原题）                                                                                   |
| 未直接使用 | BFCL 原题 JSON / 官方评分脚本                                                                                               |
| 改编说明   | 自拟假想 `get_weather`；测「该调时声明调用 + 回包前不捏造结果」（相对 TASK-17 不该调）；终态词 `TOOL_CALL_OK`；staging G-01 |
