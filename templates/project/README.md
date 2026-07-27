# 考卷库（papers-v1）

本目录由 `proctor init` 生成，是 [agent-proctor](https://github.com/agent-proctor/agent-proctor) 的**考卷资产**：试题 / 试卷 / 考场归被测仓库所有，引擎只负责装载与执行。

## 目录

```text
exam.json      # 考卷库清单：协议版本、目录布局、被测系统声明
items/         # 试题（*.item.json），按轴分子目录
papersets/     # 试卷 + 考场绑定 + 门禁
rooms/         # 考场（驱动、网络、fold_entries 等）
materials/     # 考材：每条试题的输入夹具
```

## 常用命令

```bash
npx agent-proctor item validate
npx agent-proctor item validate --check-fixtures
npx agent-proctor item validate --strict
```

## 改题铁律

改 `stimulus` 或 `expect` 的语义 → 必须升 `rev` 并在 `change_log` 写明原因；只改 `title`/`owner` 可以不升。同一 `id+rev` 在任意两次评测中必须对应同一份语义内容。
