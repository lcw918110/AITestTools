# 万象术 JsProgram 投影缺陷 · 交接要求

| 字段     | 值                                                       |
| :------- | :------------------------------------------------------- |
| 状态     | **待修复**（交由万象术侧）                               |
| 日期     | 2026-11-23                                               |
| 提出方   | AITestTools（评测器侧）                                  |
| 承接方   | 万象术（`wanxiangshu`）                                  |
| 证据来源 | 本机实测（Node 直接调用 `dist/` 产物），见第 2 节         |

> 本文只描述**需要修复什么**。所有结论均可复现，复现命令见第 3 节。

---

## 1. 缺陷结论

`dist/Repository/Programming/Js/Capability.js` 中 `JsCapabilityModule_memberNamesFor` 把**权限标签字符串**当成**`JsCapability` DU 对象**解析，导致所有角色的 JsProgram 成员投影失真。

### 失效代码

```js
// Capability.js:166-169
export function JsCapabilityModule_memberNamesFor(capabilities, roleName) {
    const labels = map_1(JsCapabilityModule_labelOf, toArray_1(capabilities));
    //                                 ↑ 传入的是字符串标签，如 "Fork"
    return JsCapabilityModule_law.membersFor(labels, roleName);
}

// Capability.js:92-126
export function JsCapabilityModule_labelOf(capability) {
    switch (capability.tag) {   // ← 字符串没有 .tag，值为 undefined
        case 1: return "Write";
        case 2: return "Glob";
        // ...
        default:
            return "Read";      // ← 全部落到这里
    }
}
```

`capabilities` 实际是**标签字符串集合**（生产路径为 `Array.from(perms(role)).map(permissionLabel)`，元素为 `"Fork"`、`"Join"` 等字符串），而 `labelOf` 按 `JsCapability` DU 的 `.tag` 分支解析。字符串的 `.tag` 为 `undefined`，全部命中 `default`，**一律返回 `"Read"`**。

同一文件内 `projectRole`（第 175 行）使用正确的 `OfficeCapability_permissionLabel` 转换，因此两个入口对同一输入给出相反结果。

---

## 2. 实测证据

### 2.1 所有标签被降级为 Read

```text
labelOf('Fork')    => "Read"
labelOf('Join')    => "Read"
labelOf('Horizon') => "Read"
labelOf('Read')    => "Read"
```

### 2.2 正确实现与失效实现的对比

`OfficeCapability_permissions()` 返回 `FSharpSet`，生产路径先转为标签数组再交给 `membersFor`，即为正确路径：

```text
Array.from(perms(Orchestrator)).map(permissionLabel)                        => ["Fork","Join","Horizon","ResetScope"]
ProgramCatalog().membersFor(上述标签数组, 'orchestrator')                    => ["fork","horizon"]
ProgramCatalog().membersFor(['Fork'], 'orchestrator')                       => ["fork"]
```

经由失效入口 `JsCapabilityModule_memberNamesFor`（内部对每个元素多套了一层 `labelOf`，字符串元素一律被解析成 `"Read"`）：

```text
memberNamesFor(['Fork'], 'orchestrator')                                    => []
memberNamesFor(['Read'], 'orchestrator')                                    => []
memberNamesFor(['Write'], 'orchestrator')                                   => []
memberNamesFor(perms(Orchestrator), 'orchestrator')                          => ["cat","ls","rg","stat","whereAll","where"]
```

### 2.3 各角色投影错位全貌

| 角色 | 真实权限 | 经失效入口投影 | 错位 |
| :--- | :--- | :--- | :--- |
| Orchestrator | `Fork, Join, Horizon, ResetScope` | `cat, ls, rg, stat, whereAll, where` | 委派能力 `fork/horizon` 全部丢失 |
| Manager | `Fork, Resume, …, Read, Glob` | `write, rm, cat, …, resume, commission, review` | 出现权限外的 `write/rm/commission` |
| Engineer | `Fission, Read, Write, …, Fetch` | `rm, mv, …, fork, resume, commission, devops, fission` | 出现权限外的 `fork/commission/devops` |
| Plan | `JsPlan, Ask, Deliver, Review…` | `cat, stat, whereAll, where` | 全部丢失 |

---

## 3. 复现命令

在 `wanxiangshu` 仓根执行：

```bash
node --input-type=module -e "
import { JsCapabilityModule_labelOf as labelOf } from './dist/Repository/Programming/Js/Capability.js';
import { JsCapabilityModule_memberNamesFor as fn } from './dist/Repository/Programming/Js/Capability.js';
import { OfficeCapability_permissions as perms, OfficeCapability_permissionLabel as lbl } from './dist/Foundation/OfficeCapability.js';
import { Role } from './dist/Foundation/Roles.js';
import { ProgramCatalog } from 'wanxiangli/program';

console.log('labelOf(Fork) =', labelOf('Fork'));
const p = perms(Role.Orchestrator);
const labels = Array.from(p).map(lbl);   // 生产路径：FSharpSet → 标签数组
console.log('权限标签 =', JSON.stringify(labels));
console.log('失效入口 =', JSON.stringify(Array.from(fn(p, 'orchestrator'))));
console.log('正确路径 =', JSON.stringify(ProgramCatalog().membersFor(labels, 'orchestrator')));
"
```

预期（缺陷存在时）：

```text
labelOf(Fork) = Read
权限标签 = ["Fork","Join","Horizon","ResetScope"]
失效入口 = ["cat","ls","rg","stat","whereAll","where"]
正确路径 = ["fork","horizon"]
```

---

## 4. 对上游评测的直接影响

评测器侧 ON 侧（插件模式）**全部超时**，历史运行包括 `wave-anthropic/claude-sonnet-5`（5 次全超时）与 `mistral/mistral-medium-latest`（超时）。日志表现为：

```text
Model tried to call unavailable tool 'invalid'.
Available tools: askPreviousScope, assume, horizon, join, skill, todowrite-for-orchestrator.
```

成因链：

1. orchestrator 的 `fork` 因投影失真未出现在 `todowrite-for-orchestrator` 的 JsProgram 基类中；
2. provider 层 `fork`/`commission` 已被 `ToolSurface.js:14-26` 主动过滤，不作为 provider 工具注册；
3. 模型无可用委派入口，反复尝试 `commission` 得到 `'invalid'`，直至 600s 超时；
4. 同题 OFF 侧（无插件）正常通过，证明任务本身可解。

**结论：该缺陷与模型能力、供应商端点、网络代理均无关。**

---

## 5. 修复要求

1. 修正 `JsCapabilityModule_memberNamesFor`：`capabilities` 已是标签字符串，应**删除多余的 `labelOf` 转换层**，直接交给 `membersFor`：

   ```js
   export function JsCapabilityModule_memberNamesFor(capabilities, roleName) {
       return JsCapabilityModule_law.membersFor(toArray_1(capabilities), roleName);
   }
   ```

   若因其他调用方存在 DU 对象入参而必须保留转换，则需让 `labelOf` 兼容字符串输入（`typeof capability === 'string'` 时原样返回字符串），并同步修正 `memberNamesFor` 的入参类型契约。

2. 修复后须满足：`memberNamesFor(perms(Role.Orchestrator), 'orchestrator')` 返回 `["fork","horizon"]`，且与 `ProgramCatalog().membersFor(标签数组, ...)` 结果一致。
3. 补一条回归测试，覆盖四种角色的「权限 → JsProgram 成员」投影，防止再次错位。

> 附注：`Join` 在正确实现下投影为空数组，与 `ResetScope` 同。若该行为非预期，请在本次修复中一并确认。
