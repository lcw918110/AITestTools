# agent-proctor

第三方独立的 Agent **监考 / 评测**引擎。  
**产品测试对象**：**模型** · **Agent（宿主）** · **万象术类插件**；工具为支撑面。

- 开源：https://github.com/lcw918110/AITestTools
- 仓库地图：[docs/00-repo-structure.md](docs/00-repo-structure.md)
- 需求：[docs/requirements/01-prd.md](docs/requirements/01-prd.md)
- **测万象术**：[docs/test/01-wanxiangshu-ops.md](docs/test/01-wanxiangshu-ops.md)
- 文档总索引（阅读序）：[docs/README.md](docs/README.md)

## 要求

- Node.js **≥ 22.22.0**（推荐 **24.18**；见 `.node-version`）

```bash
export PATH="/usr/local/bin:$PATH"
node -v
```

## 快速开始

```bash
npm install
npm run verify
npm run eval:model          # 产品效果：同题测模型（product-eval）
npm run eval:paired
npm run console             # 本地操作台 http://127.0.0.1:8787
```

测万象术效果（直播）：

```bash
unset PROCTOR_HOSTED_PLUGIN
SUT_ROOT="$(cd ../wanxiangshu && pwd)" PROCTOR_EVAL_LIVE=1 npm run eval:paired
```

工程回归（C 真 git + L1 foldEnvelope 最小面；Coordinator 已知失效）：

```bash
export SUT_ROOT="$(cd ../wanxiangshu && pwd)"
npm run smoke:wanxiangshu          # st-real-git
npm run smoke:wanxiangshu:l1       # Journal.foldEnvelope（需 dist/Journal/Fold.js）
```

schema fixture（CI，非产品效果题）：`npm run eval:model:demo-schema`

## CLI（节选）

| 命令                    | 说明                                   |
| ----------------------- | -------------------------------------- |
| `proctor run`           | 跑试卷                                 |
| `proctor compare`       | 漂移 + 效果分列（`effect_compare.md`） |
| `proctor score write`   | 参考分（不进硬门禁）                   |
| `proctor item validate` | 校验题库                               |

## 许可

MIT
