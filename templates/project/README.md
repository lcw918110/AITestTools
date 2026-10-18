# 考卷库（cases-v1）

本目录由 `proctor init` 生成，是 [agent-proctor](https://github.com/agent-proctor/agent-proctor) 的**考卷资产**：用例、修订、测试集、运行环境归被测仓库所有，引擎只负责装载与执行。

## 目录

```text
exam.json           # 考卷库清单：协议版本、目录布局、被测系统声明
cases/              # 稳定逻辑用例身份（*.case.json）
case-revisions/     # 不可变修订正文（*.case-revision.json）
dataset-releases/   # 冻结闭包（测试集，*.dataset-release.json）
environments/       # 运行环境配方（*.environment.json）
materials/          # 考材：每条用例的输入夹具
```

## 常用命令

```bash
npx agent-proctor item validate
npx agent-proctor item validate --check-fixtures
npx agent-proctor item validate --strict
npx agent-proctor run --dataset smoke-a --environment fold-v1
```

## 改题铁律

改 `stimulus` 或 `expect` 的语义 → 必须新建修订（`revision_number` +1）并重算 `content_hash`，在 `change_log` 写明原因；只改 `title`/`owner` 可以不升。同一 `case_revision_id` 在任意两次评测中必须对应同一份语义内容（`content_hash` 一致）。
