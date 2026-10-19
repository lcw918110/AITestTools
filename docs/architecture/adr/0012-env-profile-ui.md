# ADR-0012：运行环境 Profile 管理 UI（生命周期 + 复现清单实时只读采集）

| 字段   | 值                   |
| :----- | :------------------- |
| 状态   | **已采纳**           |
| 日期   | 2026-10-19           |
| 决策人 | grill-me 对齐（§32） |

## 背景

运行环境页（`apps/console/public/env.js`）已实现模型/Agent 配置 + Hello World 验证 + 环境文件（`environments/*.environment.json`）的 recipe 字段编辑，但缺少：

- **Profile 生命周期**：`EnvironmentProfile` 的 `draft → active → deprecated` 生命周期未在环境文件与界面体现，所有环境文件默认等同「可用」，无弃用语义。
- **环境复现清单**：docs/02 §4.7 要求展示 Git commit、工作树 dirty 状态、Node 版本、OS 架构、lockfile 摘要、Secret Reference 状态等，当前界面只显示 recipe 字段，无复现清单。

完整对齐 docs/03 §4.4 还涉及 Instance 编排（一键建立/检查/重置/停止/销毁/重建）与 `EnvironmentManifest` 落盘，属大工程。

## 决策

1. **先做 Profile 管理 UI，Instance 编排后置**：本次只补 Profile 生命周期与复现清单；Instance 生命周期编排与 `EnvironmentManifest` 落盘后置到后续切片。

2. **Profile 生命周期存环境文件顶层字段**：`environments/*.environment.json` 顶层加 `lifecycle` 字段（`draft / active / deprecated`），与 `recipe` 平级。流转规则：`draft → active → deprecated` 线性前进；`draft` 可反复编辑配方，`active` 可用于新 Run，`deprecated` 为终态（不再用于新 Run，但保留历史引用与按原版本复现能力）。生命周期变更不触发配方版本化。

3. **复现清单实时只读采集，不落盘**：环境页打开时后端实时采集，不写 `EnvironmentManifest` 文件（Manifest 属 Instance 编排）。采集分两组：
   - 静态：recipe 字段、Secret Reference 状态（只显示「已配置/未配置」，不显示密钥值）。
   - 运行时：Git commit（`git rev-parse HEAD`）、工作树 dirty 状态（`git status --porcelain`）、Node 版本（`node --version`）、OS 架构（`process.platform` / `process.arch`）、lockfile 摘要（`package-lock.json` 的 hash 或依赖数）。
   - 采集失败时显示「未采集/不可用」及原因，不伪造版本或 hash。

## 后果

- 正面：环境页补齐 Profile 生命周期与复现清单，用户能回答「这套环境是什么版本、可复现到什么程度」；为后续 Instance 编排打基础。
- 负面：后端需新增复现清单采集接口（执行 git/node 命令 + 读 lockfile）；环境文件 schema 需扩展 `lifecycle` 字段。
- 不做：Instance 编排（一键建立/检查/重置/停止/销毁/重建）；`EnvironmentManifest` 落盘；Secret 值展示（只显示状态）。

## 相关

- `docs/02-总体架构与领域设计.md` §4.7（Profile 生命周期流转规则）
- `docs/03-界面与交互设计.md` §4.4（Profile 管理）
- `docs/process/01-changelog.md` §32
