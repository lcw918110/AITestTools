# PAIRED-TASK-14 来源标注

| 项       | 内容                                                                                                                                                                                     |
| :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型     | **直接改编（方法论）**                                                                                                                                                                   |
| 来源     | Google Research IFEval（Instruction-Following Eval）— 可验证约束 / 指定关键词出现                                                                                                        |
| URL      | https://github.com/google-research/google-research/tree/master/instruction_following_eval                                                                                                |
| 许可     | Apache-2.0（仓库 LICENSE；数据与代码同属该开源发布）                                                                                                                                     |
| 条款摘要 | 允许复制、修改、分发衍生作品；须保留NOTICE/版权声明；专利与免责条款见 Apache-2.0                                                                                                         |
| 改编说明 | **不**搬运 IFEval 原题干（维基摘要/旅行 itinerary 等）；把「输出须含指定可验证 token」约束改写成编码助手「先引用再断言」场景；终态词 `CITE_OK` + 引用 token `DOC_CI_NODE_PIN` 为本库自拟 |
