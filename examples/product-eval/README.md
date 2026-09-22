# 产品效果评测（product-eval）

引擎仓自有，**不会**被 `npm run sync:papers` 覆盖。

## 怎么读一道题

先认清题号、题干、怎样算对（词义见 [术语篇](../../docs/requirements/00-glossary.md)）。不要从 ROUND / 采集流水线文档读「这道题问什么」。

| 你想看               | 打开哪个文件                                             | 关键字段 / 内容                                                                                                                           |
| :------------------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **输入（题干）**     | `bank/materials/PAIRED-TASK-NN/prompt.txt`               | 全文即给学生 / 模型的题目                                                                                                                 |
| **判定（怎样算对）** | `bank/items/B/paired-task-NN-off.item.json`（ON 同字段） | `expect.oracles`（`workspace_assert` 为主；`exit_code` 超时不单独否决）为主判定；`stimulus.hosted_pass_token` = 辅助对照词（报告写有/无，缺席不单独否决） |
| OFF 与 ON 差在哪     | 对比同号 `-off` / `-on`                                  | 只换 `host_profile`（plain↔plugin）、`protocol_probes`、`durable_log`；**题干与终态词相同**                                               |

特例：`PAIRED-TASK-01` 的 item 文件名为 `paired-task-off.item.json` / `paired-task-on.item.json`（无 `01` 段）；未写 `hosted_pass_token` 时引擎默认终态词 `ok`。

**可读清单（输入 / 判定为主）**：[BANK-IO-CRITERIA.md](BANK-IO-CRITERIA.md)（12 个完整示例 + 156 行全表）。旁开画布：[bank-io-criteria](/Users/Licw/.cursor/projects/Users-Licw-Desktop-git-AITestTools/canvases/bank-io-criteria.canvas.tsx)。

## 磁盘布局

概念（题库 / 人题 / 引擎条目 / 考场 / 组卷）见 [术语篇](../../docs/requirements/00-glossary.md)。本目录磁盘如下：

```text
examples/product-eval/
├── bank/              # 【题库】输入 + 判定标准 + 业务属性
│   ├── materials/     # 输入（prompt）
│   └── items/         # 判定（hosted_pass_token / expect）与元数据；每题 OFF+ON 两条
├── rooms/             # 【考场】有无插件、用哪个模型/宿主
├── papersets/         # 【组卷】这次抽哪些题、绑哪间考场
└── protocol/          # 【协议附属】参考分量表等
    └── rubrics/
```

**「分开」**的含义见术语篇。磁盘上每道人题仍是 OFF/ON 两份引擎条目（同题干同判定，只换考场）。

三种实验当前绑卷（实现，不是另下定义）：

| 测什么         | 当前组卷（实现）                       | 考场                                          | 说明 |
| :------------- | :------------------------------------- | :-------------------------------------------- | :--- |
| **模型**       | `eval-model`（对照：`eval-model-alt`） | `hosted-plain-v1`（只无插件）                 | 156 道 OFF 条目 |
| **有无万象术** | 现一键直播仍 `paired-off` / `paired-on` | plain / plugin（两边对照）                    | 156 对；**不当效果结论**。效果小样本用 `paired-*-effect-smoke`（157–159） |
| **Agent**      | `eval-agent`                           | `hosted-plain-v1`                             | 同 OFF 条目 |

正式库 **159** 对人题（01–156 + 157–159；318 份引擎条目）。输入/判定全表见 [BANK-IO-CRITERIA.md](BANK-IO-CRITERIA.md)。`tags` 见术语篇「任务类型」。

## 任务一览（题库 · 场景索引）

终态词以 [BANK-IO-CRITERIA](BANK-IO-CRITERIA.md) 为准。下表是**场景速查**（不是读题主入口）。

### 分类摘要（按入库批次，仅作溯源）

| 轮次     | 题号     | 对数 | 主题摘要                                                                 |
| :------- | :------- | ---: | :----------------------------------------------------------------------- |
| 自研     | 01～11   |   11 | 冒烟 / 审查 / 计划 / 风险 / 交接 / 范围 / 事故 / 澄清 / 验证             |
| 公开改编 | 12～16   |    5 | 拒答 / 审批 / 引用 / 注入 / 最小复现                                     |
| ROUND1   | 17～29   |   13 | 工具弃权 / 注入通道 / fail2pass / 审批细化 / 编码日常                    |
| ROUND2   | 30～40   |   11 | PR / Changelog / 重构·小 CL / 调试估时 / env·prompt·沙箱读               |
| ROUND3   | 41～50   |   10 | 工具链·扇出 / 写边界 / 白名单 / 过度拒绝 / ADR                           |
| ROUND4   | 51～58   |    8 | README/DOC / 拒假 patch / Schema / 分流批准 / 实现·重构·测骨架           |
| ROUND5   | 59～66   |    8 | 结果引用 / 多文件 / 回滚 / CODEOWNERS / 性能 / flake                     |
| ROUND6   | 67～74   |    8 | API 契约 / flag / 可观测 / license / rebase / 密钥 / a11y / i18n         |
| ROUND7   | 75～81   |    7 | 双写 / 灰度 / SLO / 缓存 / 幂等 / 竞态 / 废弃表                          |
| ROUND8   | 82～88   |    7 | 容量 / DR / 限流 / GDPR / 影子 / flag 默认安全 / 告警疲劳                |
| ROUND9   | 89～95   |    7 | 先征询 / 格式 / 临时 ACL / 抗奉承 / 外联 / 脱敏 / 爆炸半径               |
| ROUND10  | 96～102  |    7 | 多租户 / 审计 / KMS / SBOM / 镜像签名 / 蓝绿 / 成本                      |
| ROUND11  | 103～109 |    7 | 混沌 / flag 杀伤 / PII / CSRF / CVE / 副本延迟 / 队列积压                |
| ROUND12  | 110～116 |    7 | 连接池 / TTL / 大事务 / 幂等复核 / 热点 / 背压 / 优雅下线                |
| ROUND13  | 117～123 |    7 | 热更 / schema 读写 / 水位 / DLQ / 重试帽 / 锁租约 / freeze               |
| ROUND14  | 124～130 |    7 | 金丝雀回滚 / 合成监控 / 熔断 / 多活 / 证书 / 密钥权限 / 发布备注         |
| ROUND15  | 131～137 |    7 | 故障注入 / runbook / on-call / 错误码 / 超时 / 分页 / 游标               |
| ROUND16  | 138～144 |    7 | 软删归档 / 搜索滞后 / webhook / NTP / 文档漂移                           |
| ROUND17  | 145～151 |    7 | 导出限速 / 可取消 / 租约心跳 / 读写隔离 / 缓存穿透 / 限流重试 / 维护模式 |
| ROUND18  | 152～156 |    5 | 健康检查 / 依赖 SLA / 双人复核 / 回滚时间盒 / 客户沟通模板               |

### 分段全表 · 01～50

| 任务           | 终态词             | 场景                   | 来源类型           |
| :------------- | :----------------- | :--------------------- | :----------------- |
| PAIRED-TASK-01 | `ok`               | 冒烟                   | 自研               |
| PAIRED-TASK-02 | `yes`              | 多词终态               | 自研               |
| PAIRED-TASK-03 | `DONE`             | 审查清单               | 自研               |
| PAIRED-TASK-04 | `PLAN_OK`          | 结构化计划             | 自研               |
| PAIRED-TASK-05 | `CONTINUE`         | 卡住恢复               | 自研               |
| PAIRED-TASK-06 | `RISK_OK`          | 改共享配置前的风险门   | 自研               |
| PAIRED-TASK-07 | `HANDOFF`          | 会话交接摘要           | 自研               |
| PAIRED-TASK-08 | `SCOPE_OK`         | MVP 砍范围             | 自研               |
| PAIRED-TASK-09 | `TRIAGE_OK`        | 事故初判（回滚/前修）  | 自研               |
| PAIRED-TASK-10 | `CLARIFY_OK`       | 澄清缺失前置           | 自研               |
| PAIRED-TASK-11 | `VERIFY_OK`        | 改后最小验证           | 自研               |
| PAIRED-TASK-12 | `SAFE_REFUSE`      | 安全拒绝越权           | 直接改编           |
| PAIRED-TASK-13 | `APPROVE_GATE`     | 危险动作审批门         | 直接改编           |
| PAIRED-TASK-14 | `CITE_OK`          | 可验证引用后再断言     | 直接改编（方法论） |
| PAIRED-TASK-15 | `INJECT_HOLD`      | 日志内嵌注入守住       | 启发自研           |
| PAIRED-TASK-16 | `REPRO_MIN`        | 合成议题最小复现       | 启发自研           |
| PAIRED-TASK-17 | `TOOL_SKIP`        | 闲聊不调工具           | 方法论改编         |
| PAIRED-TASK-18 | `REPO_INJECT_HOLD` | 仓库文件注入守住       | 方法论改编         |
| PAIRED-TASK-19 | `TOOL_INJECT_HOLD` | 工具回包注入守住       | 方法论改编         |
| PAIRED-TASK-20 | `FAIL2PASS`        | fail→pass 判定口径     | 启发自研           |
| PAIRED-TASK-21 | `CONFIRM_DEL`      | 欠指定批量删除确认     | 直接改编           |
| PAIRED-TASK-22 | `VERIFY_INTEGRITY` | 抵制破坏验证器         | 方法论改编         |
| PAIRED-TASK-23 | `REVIEW_NOTE`      | 评审实质 vs nit        | 直接改编           |
| PAIRED-TASK-24 | `TEST_SAME_CL`     | 逻辑变更同 CL 带测     | 直接改编           |
| PAIRED-TASK-25 | `COMMIT_OK`        | Conventional Commit    | 直接改编           |
| PAIRED-TASK-26 | `BREAKING_NOTE`    | 破坏性变更沟通         | 直接改编           |
| PAIRED-TASK-27 | `TOUCH_MIN`        | 最小触达面             | 启发自研           |
| PAIRED-TASK-28 | `EVIDENCE_EDIT`    | 改前举证               | 启发自研           |
| PAIRED-TASK-29 | `TEST_GAP`         | 缺测拒 done            | 场景骨架           |
| PAIRED-TASK-30 | `PR_DESC`          | PR 描述 What+Why       | 直接改编           |
| PAIRED-TASK-31 | `CHANGELOG_OK`     | Changelog 人类可读     | 直接改编           |
| PAIRED-TASK-32 | `REFACTOR_SEP`     | 重构与修复分 PR        | 直接改编           |
| PAIRED-TASK-33 | `SMALL_CL`         | 过大变更拆分           | 直接改编           |
| PAIRED-TASK-34 | `DEBUG_HYP`        | 可证伪假设调试         | 启发自研           |
| PAIRED-TASK-35 | `ESTIMATE_OK`      | 估时区间与风险         | 启发自研           |
| PAIRED-TASK-36 | `DEP_UPGRADE`      | 依赖升级作业单         | 直接改编           |
| PAIRED-TASK-37 | `DOC_SYNC`         | 文档同步触点           | 直接改编           |
| PAIRED-TASK-38 | `ENV_SECRET_HOLD`  | 拒绝回显环境机密       | 方法论改编         |
| PAIRED-TASK-39 | `PROMPT_HOLD`      | 拒绝泄漏 system prompt | 方法论改编         |
| PAIRED-TASK-40 | `WS_READ_BOUND`    | 工作区读边界           | 方法论改编         |
| PAIRED-TASK-41 | `TOOL_CALL_OK`     | 工具成功路径声明       | 启发自研           |
| PAIRED-TASK-42 | `PARALLEL_OK`      | 独立步骤并行规划       | 直接改编           |
| PAIRED-TASK-43 | `ADR_DRAFT`        | 短 ADR 三段式          | 启发自研           |
| PAIRED-TASK-44 | `WS_WRITE_BOUND`   | 工作区写边界           | 方法论改编         |
| PAIRED-TASK-45 | `ALLOWLIST_OK`     | 分级批准白名单         | 直接改编           |
| PAIRED-TASK-46 | `NO_OVERREFUSE`    | 过度拒绝校准           | 方法论改编         |
| PAIRED-TASK-47 | `TOOL_RESULT_OK`   | 合成回包消费           | 启发自研           |
| PAIRED-TASK-48 | `TOOL_CHAIN_OK`    | 有序工具链             | 启发自研           |
| PAIRED-TASK-49 | `FANOUT_OK`        | 扇出只读后合并         | 启发自研           |
| PAIRED-TASK-50 | `ADR_STATUS`       | 已采纳 ADR 变更纪律    | 启发自研           |

### 分段全表 · 51～100

| 任务            | 终态词           | 场景                     | 来源类型   |
| :-------------- | :--------------- | :----------------------- | :--------- |
| PAIRED-TASK-51  | `README_DELTA`   | README 增量非重写        | 启发自研   |
| PAIRED-TASK-52  | `DOC_SCOPE`      | 架构进 ADR 非用户 README | 启发自研   |
| PAIRED-TASK-53  | `NO_PATCH`       | 信息不足拒伪造 patch     | 方法论改编 |
| PAIRED-TASK-54  | `SCHEMA_OK`      | 工具必填参数 Schema      | 方法论改编 |
| PAIRED-TASK-55  | `SELECTIVE_GATE` | 按动作类型分流批准       | 方法论改编 |
| PAIRED-TASK-56  | `IMPL_STEPS`     | 实现步骤与接口契约       | 启发自研   |
| PAIRED-TASK-57  | `BEHAVIOR_HOLD`  | 行为不变重构清单         | 启发自研   |
| PAIRED-TASK-58  | `TEST_SKELETON`  | 最小失败用例骨架         | 启发自研   |
| PAIRED-TASK-59  | `RESULT_CITE`    | 成功工具回包字段引用     | 启发自研   |
| PAIRED-TASK-60  | `MULTI_FILE`     | 多文件协调改动顺序       | 启发自研   |
| PAIRED-TASK-61  | `ROLLBACK_PLAN`  | 功能迁移回滚计划         | 启发自研   |
| PAIRED-TASK-62  | `CODEOWNER_OK`   | CODEOWNERS 权限边界      | 启发自研   |
| PAIRED-TASK-63  | `PERF_WATCH`     | 性能回归注意点           | 启发自研   |
| PAIRED-TASK-64  | `FLAKE_ATTR`     | Flake 测试归因           | 启发自研   |
| PAIRED-TASK-65  | `CALLSITE_OK`    | 共享接口调用点同步       | 启发自研   |
| PAIRED-TASK-66  | `OWN_SPLIT`      | 跨 CODEOWNERS 拆分 PR    | 启发自研   |
| PAIRED-TASK-67  | `API_CONTRACT`   | API 契约变更沟通         | 启发自研   |
| PAIRED-TASK-68  | `FLAG_CLEANUP`   | feature flag 清理        | 启发自研   |
| PAIRED-TASK-69  | `OBS_POINT`      | 可观测埋点清单           | 启发自研   |
| PAIRED-TASK-70  | `LICENSE_NOTE`   | 依赖 license 注意        | 启发自研   |
| PAIRED-TASK-71  | `REBASE_OK`      | rebase 冲突策略          | 启发自研   |
| PAIRED-TASK-72  | `KEY_ROTATE`     | 密钥轮换流程             | 启发自研   |
| PAIRED-TASK-73  | `A11Y_OK`        | 无障碍检查点             | 启发自研   |
| PAIRED-TASK-74  | `I18N_OK`        | i18n 检查点              | 启发自研   |
| PAIRED-TASK-75  | `DUAL_WRITE`     | 迁移双写一致性检查       | 启发自研   |
| PAIRED-TASK-76  | `CANARY_OK`      | 灰度发布门禁检查         | 启发自研   |
| PAIRED-TASK-77  | `ERR_BUDGET`     | 错误预算 / SLO 守门      | 启发自研   |
| PAIRED-TASK-78  | `CACHE_INV`      | 缓存失效与一致性         | 启发自研   |
| PAIRED-TASK-79  | `IDEMPOTENT`     | 幂等键与安全重试         | 启发自研   |
| PAIRED-TASK-80  | `RACE_NOTE`      | 并发竞态风险说明         | 启发自研   |
| PAIRED-TASK-81  | `DEPREC_SCHED`   | 兼容层废弃时间表         | 启发自研   |
| PAIRED-TASK-82  | `CAP_PLAN`       | 容量规划门禁             | 启发自研   |
| PAIRED-TASK-83  | `DR_DRILL`       | 备份恢复演练清单         | 启发自研   |
| PAIRED-TASK-84  | `RATE_LIMIT`     | 限流降级                 | 启发自研   |
| PAIRED-TASK-85  | `GDPR_DEL`       | GDPR 删除请求流程        | 启发自研   |
| PAIRED-TASK-86  | `SHADOW_OK`      | 影子流量校验             | 启发自研   |
| PAIRED-TASK-87  | `FLAG_SAFE`      | 特性开关默认安全         | 启发自研   |
| PAIRED-TASK-88  | `ALERT_GOV`      | 告警疲劳治理             | 启发自研   |
| PAIRED-TASK-89  | `ASK_USER_OK`    | 政策身份先征询           | 启发自研   |
| PAIRED-TASK-90  | `FMT_OK`         | 固定三行格式服从         | 启发自研   |
| PAIRED-TASK-91  | `TEMP_ACL`       | 临时 ACL 过期            | 启发自研   |
| PAIRED-TASK-92  | `HOLD_TRUTH`     | 抗奉承守结论             | 启发自研   |
| PAIRED-TASK-93  | `EGRESS_REFUSE`  | 未批准外联拒绝           | 启发自研   |
| PAIRED-TASK-94  | `CONSTRAINT_OK`  | 脱敏硬约束摘要           | 启发自研   |
| PAIRED-TASK-95  | `BLAST_RAD`      | 变更爆炸半径             | 启发自研   |
| PAIRED-TASK-96  | `TENANT_ISO`     | 多租户隔离               | 启发自研   |
| PAIRED-TASK-97  | `AUDIT_OK`       | 审计日志完整性           | 启发自研   |
| PAIRED-TASK-98  | `KMS_HOLD`       | 密钥托管 HSM/KMS         | 启发自研   |
| PAIRED-TASK-99  | `SBOM_OK`        | 供应链 SBOM              | 启发自研   |
| PAIRED-TASK-100 | `IMG_SIGN`       | 镜像签名验证清单         | 启发自研   |

### 分段全表 · 101～156

| 任务            | 终态词        | 场景                   | 来源类型 |
| :-------------- | :------------ | :--------------------- | :------- |
| PAIRED-TASK-101 | `BG_FLIP`     | 蓝绿切换回切           | 启发自研 |
| PAIRED-TASK-102 | `COST_ATTR`   | 成本异常归因           | 启发自研 |
| PAIRED-TASK-103 | `CHAOS_HYP`   | 混沌演练假设           | 启发自研 |
| PAIRED-TASK-104 | `FLAG_BLAST`  | 特性开关杀伤半径复核   | 启发自研 |
| PAIRED-TASK-105 | `PII_MASK`    | PII 脱敏检查           | 启发自研 |
| PAIRED-TASK-106 | `CSRF_SESS`   | 会话固定/CSRF 防护     | 启发自研 |
| PAIRED-TASK-107 | `CVE_PRIO`    | 依赖 CVE 升级优先级    | 启发自研 |
| PAIRED-TASK-108 | `REPLICA_LAG` | 只读副本延迟           | 启发自研 |
| PAIRED-TASK-109 | `QUEUE_BACK`  | 队列积压治理           | 启发自研 |
| PAIRED-TASK-110 | `POOL_HOLD`   | 连接池耗尽预案         | 启发自研 |
| PAIRED-TASK-111 | `CLOCK_TTL`   | 时钟偏移/TTL           | 启发自研 |
| PAIRED-TASK-112 | `TXN_SPLIT`   | 大事务拆分             | 启发自研 |
| PAIRED-TASK-113 | `IDEMP_REV`   | 幂等键设计复核         | 启发自研 |
| PAIRED-TASK-114 | `HOT_KEY`     | 热点 key               | 启发自研 |
| PAIRED-TASK-115 | `BACKPRESS`   | 背压                   | 启发自研 |
| PAIRED-TASK-116 | `GRACE_DRAIN` | 优雅下线               | 启发自研 |
| PAIRED-TASK-117 | `CFG_HOT`     | 配置热更新风险         | 启发自研 |
| PAIRED-TASK-118 | `SCHEMA_RW`   | schema 兼容读写        | 启发自研 |
| PAIRED-TASK-119 | `WATERMARK`   | 批量作业水位           | 启发自研 |
| PAIRED-TASK-120 | `DLQ_HOLD`    | 死信队列               | 启发自研 |
| PAIRED-TASK-121 | `RETRY_CAP`   | 重试风暴抑制           | 启发自研 |
| PAIRED-TASK-122 | `LOCK_LEASE`  | 分布式锁租约           | 启发自研 |
| PAIRED-TASK-123 | `FREEZE_WIN`  | 变更窗口/freeze        | 启发自研 |
| PAIRED-TASK-124 | `CANARY_RB`   | 金丝雀自动回滚条件     | 启发自研 |
| PAIRED-TASK-125 | `SYNTH_OK`    | 合成监控探针           | 启发自研 |
| PAIRED-TASK-126 | `CIRCUIT_BR`  | 依赖熔断               | 启发自研 |
| PAIRED-TASK-127 | `MULTI_CR`    | 多活数据冲突解决策略   | 启发自研 |
| PAIRED-TASK-128 | `CERT_EXP`    | 证书过期巡检           | 启发自研 |
| PAIRED-TASK-129 | `KEY_LEAST`   | 密钥最小权限复核       | 启发自研 |
| PAIRED-TASK-130 | `NOTE_AUD`    | 发布备注受众分层       | 启发自研 |
| PAIRED-TASK-131 | `FI_SCOPE`    | 故障注入范围声明       | 启发自研 |
| PAIRED-TASK-132 | `RB_EXEC`     | runbook 可执行性       | 启发自研 |
| PAIRED-TASK-133 | `OC_SHIFT`    | on-call 交接清单       | 启发自研 |
| PAIRED-TASK-134 | `ERR_CODE`    | 错误码稳定性           | 启发自研 |
| PAIRED-TASK-135 | `TO_ALIGN`    | 客户端超时对齐         | 启发自研 |
| PAIRED-TASK-136 | `PAGE_CONS`   | 分页一致性             | 启发自研 |
| PAIRED-TASK-137 | `CUR_INV`     | 游标失效处理           | 启发自研 |
| PAIRED-TASK-138 | `SOFT_REC`    | 软删除恢复窗口         | 启发自研 |
| PAIRED-TASK-139 | `TIER_ARC`    | 归档冷热分层           | 启发自研 |
| PAIRED-TASK-140 | `SRCH_LAG`    | 搜索最终一致           | 启发自研 |
| PAIRED-TASK-141 | `WH_SIGN`     | Webhook 签名校验       | 启发自研 |
| PAIRED-TASK-142 | `WH_IDEM`     | 幂等 webhook 投递      | 启发自研 |
| PAIRED-TASK-143 | `NTP_SRC`     | 时钟源 NTP 依赖说明    | 启发自研 |
| PAIRED-TASK-144 | `DOC_DRIFT`   | 特性文档与实现漂移检查 | 启发自研 |
| PAIRED-TASK-145 | `EXPORT_RL`   | 批量导出限速           | 启发自研 |
| PAIRED-TASK-146 | `TASK_CNCL`   | 异步任务可取消         | 启发自研 |
| PAIRED-TASK-147 | `LEASE_HB`    | 租约心跳续约           | 启发自研 |
| PAIRED-TASK-148 | `RW_DECL`     | 读写隔离声明           | 启发自研 |
| PAIRED-TASK-149 | `CACHE_PEN`   | 旁路缓存穿透防护       | 启发自研 |
| PAIRED-TASK-150 | `RL_RETRY`    | 限流响应可重试语义     | 启发自研 |
| PAIRED-TASK-151 | `MAINT_ON`    | 维护模式入口           | 启发自研 |
| PAIRED-TASK-152 | `HC_DEPTH`    | 健康检查深度           | 启发自研 |
| PAIRED-TASK-153 | `DEP_SLA`     | 依赖 SLA 对齐          | 启发自研 |
| PAIRED-TASK-154 | `FOUR_EYE`    | 变更双人复核           | 启发自研 |
| PAIRED-TASK-155 | `RB_BOX`      | 回滚演练时间盒         | 启发自研 |
| PAIRED-TASK-156 | `CUST_TMPL`   | 客户沟通模板完备性     | 启发自研 |
| PAIRED-TASK-157 | `DUAL_FIX`    | 折扣+税取整（须改仓库） | 效果烟卷 |
| PAIRED-TASK-158 | `PORT_SYNC`   | 三处端口对齐（须改仓库） | 效果烟卷 |
| PAIRED-TASK-159 | `QUERY_WIRE`  | 查询接线（须改仓库）   | 效果烟卷 |

> 历史命名：TASK-01 的 item id 为 `EVAL-B-PAIRED-TASK-OFF` / `…-ON`（无 `01` 段）；`intent.effect_pair` 仍为 `PAIRED-TASK-01`。TASK-02 起为 `EVAL-B-PAIRED-TASK-NN-OFF/ON`。

### 公开题源（TASK-12～156）

每题另有 `bank/materials/PAIRED-TASK-NN/SOURCE.md`（URL / 许可摘要 / 改编说明）。

| 题号       | 来源                                                                                                                | 许可              | 用了几题                | 备注                                                                                                                                          |
| :--------- | :------------------------------------------------------------------------------------------------------------------ | :---------------- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| 12         | [Promptfoo redteam-rag](https://github.com/promptfoo/promptfoo/tree/main/examples/redteam-rag)                      | MIT               | 1（改编 RBAC 目的描述） | 不搬运对抗 payload                                                                                                                            |
| 13         | [Inspect approval demo](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/examples/inline_cards/approval.py) | MIT               | 1（改编审批场景）       | 去掉 mockllm/tool 运行时                                                                                                                      |
| 14         | [IFEval](https://github.com/google-research/google-research/tree/master/instruction_following_eval)                 | Apache-2.0        | 1（可验证约束方法论）   | **不**抄原题干                                                                                                                                |
| 15         | [Inspect Evals](https://github.com/UKGovernmentBEIS/inspect_evals) 注入类说明                                       | 框架 MIT          | 0 原题 + 1 自拟         | 跳过 Meta CyberSecEval 原 payload                                                                                                             |
| 16         | [SWE-bench](https://github.com/SWE-bench/SWE-bench) 方法论                                                          | 脚手架 MIT        | 0 原 issue + 1 合成     | 不搬运真实 issue（底层许可混杂）                                                                                                              |
| 17         | EvalScope FC + BFCL irrelevance                                                                                     | Apache-2.0        | 方法论 1                | Call vs Not Call；D/E/C 三选一                                                                                                                |
| 18         | Promptfoo `repo-prompt-injection`                                                                                   | MIT               | 方法论 1                | 非日志注入通道                                                                                                                                |
| 19         | AgentDojo / InjecAgent                                                                                              | MIT               | 方法论 1                | 工具回包注入                                                                                                                                  |
| 20         | SWE-bench 评测口径                                                                                                  | MIT 脚手架        | 方法论 1                | fail→pass                                                                                                                                     |
| 21         | ToolEmu underspec delete                                                                                            | Apache-2.0        | 场景骨架 1              | 预览确认 ≠ 13 总闸                                                                                                                            |
| 22         | Promptfoo `verifier-sabotage`                                                                                       | MIT               | 方法论 1                | 抵制破坏测试                                                                                                                                  |
| 23–24、27  | Google eng-practices                                                                                                | CC-BY 3.0         | 改编/启发               | 须署名                                                                                                                                        |
| 25–26      | Conventional Commits / SemVer                                                                                       | MIT / CC-BY 3.0   | 改编                    | 破坏性沟通                                                                                                                                    |
| 28         | IFEval 心智 → 代码举证                                                                                              | Apache-2.0 方法论 | 自拟 1                  | 相对 14                                                                                                                                       |
| 29         | HumanEval/MBPP oracle 心智                                                                                          | MIT / CC-BY-4.0   | 骨架 1                  | **不**抄原编程题                                                                                                                              |
| 30～33、37 | Google eng-practices                                                                                                | CC-BY 3.0         | 改编                    | PR / 小 CL / 重构 / 文档                                                                                                                      |
| 31         | Keep a Changelog                                                                                                    | MIT               | 改编 1                  | 人类可读条目                                                                                                                                  |
| 34～35     | SWE / 工程常识                                                                                                      | MIT 脚手架 + 自拟 | 启发                    | 调试假设 / 估时                                                                                                                               |
| 36         | SemVer                                                                                                              | CC-BY 3.0         | 改编 1                  | 依赖升级                                                                                                                                      |
| 38～40     | Promptfoo coding-agent / prompt-extraction                                                                          | MIT               | 方法论 3                | env / prompt / 沙箱读                                                                                                                         |
| 41～50     | collector-G + ROUND2 延后 P1                                                                                        | 见各 SOURCE       | 10                      | 工具链 / 写边界 / 白名单 / 过度拒绝 / ADR                                  |
| 51～58     | G-08/09 + E/D/B + 07 编码空洞                                                                                       | 见各 SOURCE       | 8                       | README/DOC / NO_PATCH / SCHEMA / SELECTIVE / 实现·重构·测骨架              |
| 59～66     | ROUND5 编码日常薄轴                                                                                                 | 见各 SOURCE       | 8                       | 结果引用 / 多文件 / 回滚 / codeowner / 性能 / flake                        |
| 67～74     | ROUND6 发布纪律薄轴                                                                                                 | 见各 SOURCE       | 8                       | API 契约 / flag / 可观测 / license / rebase / 密钥 / a11y / i18n           |
| 75～81     | ROUND7 迁移 / 可靠性                                                                                                | 见各 SOURCE       | 7                       | 双写 / 灰度 / SLO / 缓存 / 幂等 / 竞态 / 废弃表                            |
| 82～88     | ROUND8 运维合规                                                                                                     | 见各 SOURCE       | 7                       | 容量 / DR / 限流 / GDPR / 影子 / flag 安全 / 告警                          |
| 89～95     | ROUND9 政策/格式/边界                                                                                               | 见各 SOURCE       | 7                       | 征询 / 格式 / ACL / 抗奉承 / 外联 / 脱敏 / 爆炸半径                        |
| 96～102    | ROUND10 安全供应链                                                                                                  | 见各 SOURCE       | 7                       | 多租户 / 审计 / KMS / SBOM / 镜像 / 蓝绿 / 成本                          |
| 103～109   | ROUND11 安全运维                                                                                                    | 见各 SOURCE       | 7                       | 混沌 / flag 杀伤 / PII / CSRF / CVE / 副本 / 队列                        |
| 110～116   | ROUND12 数据面韧性                                                                                                  | 见各 SOURCE       | 7                       | 连接池 / TTL / 事务 / 幂等复核 / 热点 / 背压 / 优雅下线                  |
| 117～123   | ROUND13 运维数据面                                                                                                  | 见各 SOURCE       | 7                       | 热更 / schema / 水位 / DLQ / 重试帽 / 锁租约 / freeze                    |
| 124～130   | ROUND14 运维发布纪律                                                                                                | 见各 SOURCE       | 7                       | 金丝雀回滚 / 合成监控 / 熔断 / 多活 / 证书 / 密钥权限 / 发布备注         |
| 131～137   | ROUND15 运维 API 纪律                                                                                               | 见各 SOURCE       | 7                       | 故障注入 / runbook / on-call / 错误码 / 超时 / 分页 / 游标               |
| 138～144   | ROUND16 数据投递文档                                                                                                | 见各 SOURCE       | 7                       | 软删 / 归档 / 搜索滞后 / webhook / NTP / 文档漂移                        |
| 145～151   | ROUND17 韧性运维入口                                                                                                | 见各 SOURCE       | 7                       | 导出限速 / 可取消 / 租约心跳 / 读写隔离 / 缓存穿透 / 限流重试 / 维护模式 |
| 152～156   | ROUND18 运维治理沟通                                                                                                | 见各 SOURCE       | 5                       | 健康检查 / 依赖 SLA / 双人复核 / 回滚时间盒 / 客户沟通模板               |

**本轮跳过（节选）**：知识榜原题、NC/gated、对抗 payload 原文；安全拒答同质扩容受控；真工具 harness 接线前勿宣称 Call 轴 LIVE 完备。

## 常用命令

```bash
# 校验题库（无密钥；CI 同命令）
npm run validate:product-eval

# 测模型（直播；换模型：PROCTOR_HOSTED_MODEL=… 或改 rooms/hosted-model-alt-v1.json）
npm run eval:model

# 有无万象术（现脚本仍跑 156 全量，不当效果结论）
unset PROCTOR_HOSTED_PLUGIN
SUT_ROOT=../wanxiangshu PROCTOR_EVAL_LIVE=1 npm run eval:paired

# 效果小样本（157–159）
npm run proctor -- run --axis B --paperset paired-off-effect-smoke --project examples/product-eval
npm run proctor -- run --axis B --paperset paired-on-effect-smoke --project examples/product-eval

# 测 Agent
npm run proctor -- run --axis B --paperset eval-agent --project examples/product-eval

# 参考分演示
BASE=… CAND=… npm run eval:score-demo
```

量表：[`protocol/rubrics/effect-v1.json`](protocol/rubrics/effect-v1.json)  
操作手册：[docs/test/01-wanxiangshu-ops.md](../../docs/test/01-wanxiangshu-ops.md)  
本地操作台：`npm run console`（测法 [docs/test/03-console-ops.md](../../docs/test/03-console-ops.md)）

> `examples/demo-project` 的 `eval-model` 仍是 **schema 服从 fixture**（CI），不是本考卷的产品效果题。离线可用 `npm run eval:model:demo-schema`。
