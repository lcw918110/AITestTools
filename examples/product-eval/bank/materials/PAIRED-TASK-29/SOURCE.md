# PAIRED-TASK-29 来源标注

| 项         | 内容                                                                                                       |
| :--------- | :--------------------------------------------------------------------------------------------------------- |
| 类型       | **场景骨架（启发自研）**                                                                                   |
| 启发来源   | HumanEval / MBPP「单元测试作 oracle」心智                                                                  |
| URL        | https://github.com/openai/human-eval · https://github.com/google-research/google-research/tree/master/mbpp |
| 许可       | HumanEval **MIT**；MBPP **CC-BY-4.0**（方法论引用；**不**抄原题）                                          |
| 未直接使用 | 原编程题 docstring / 标准答案 / 题号                                                                       |
| 改编说明   | 自拟 `clampPercent`；测缺测拒虚假完成（相对 F-04 同 CL 带测）；终态词 `TEST_GAP`                           |
