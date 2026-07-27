# 万象术考卷库（引擎仓本地副本）

| 字段   | 值                                            |
| :----- | :-------------------------------------------- |
| 权威源 | 邻仓 `wanxiangshu/papers`（产品侧）           |
| 本目录 | **运行时默认题库**（ADR-0008）                |
| 同步   | `SUT_ROOT=../wanxiangshu npm run sync:papers` |

## 运行（Fold 需 SUT_ROOT 指向万象术仓根）

```bash
export PATH="/usr/local/bin:$PATH"
export SUT_ROOT="$(cd ../wanxiangshu && pwd)"   # 读 build/ Fold / Plugin

npm run proctor -- run --axis A --paperset smoke-A-L1 \
  --project examples/wanxiangshu-papers

npm run proctor -- run --axis A --paperset st-import-L1 \
  --project examples/wanxiangshu-papers

npm run proctor -- run --axis C --paperset st-real-git \
  --project examples/wanxiangshu-papers
```

**不要**把本目录下的 `runs/` 提交进 git。
