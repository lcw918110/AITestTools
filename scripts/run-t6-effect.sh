#!/usr/bin/env bash
# T6 效果实验备卷脚本：157–159 三题 OFF/ON 对照（专用卷 paired-*-effect-smoke）
#
# DoD 对齐（changelog §6 / docs/process/06-next-steps.md §3）：
#   1. OFF 必挂、ON 有机会过（剔除 CONTEXT 归因后）
#   2. 小样本对照跑通（paired-off-effect-smoke → paired-on-effect-smoke → compare）
#   3. 报告可读出 OFF 通过率 < ON
#   4. 156 全量不当作效果结论
#
# 用法：
#   PROCTOR_HOSTED_MODEL=kw92.cyou/lazy/task bash scripts/run-t6-effect.sh
# 依赖：
#   - SUT_ROOT 指向万象术仓（ON 侧挂插件需要）
#   - 编排链（orchestrator → manager → devops）已由万象术侧接通，否则 ON 侧
#     会话数恒零、通过率不反映插件真实效果，仅可作环境连通性冒烟
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

: "${PROCTOR_HOSTED_MODEL:?必须导出 PROCTOR_HOSTED_MODEL，例如 kw92.cyou/lazy/task}"
RUN_TAG="$(date +%Y%m%d-%H%M%S)"

echo "=== T6 效果实验（模型：${PROCTOR_HOSTED_MODEL}）==="

# proctor run 在有试题失败时返回退出码 1，而 T6 的 DoD 恰恰预期 OFF 侧必挂：
# 不能让非零退出码中止脚本，须记录退出码、以 JSON 产物为准继续。
echo "[1/3] OFF 侧：paired-off-effect-smoke（157-159 无插件）"
OFF_RC=0
npx tsx src/cli/main.ts run --project examples/product-eval \
  --dataset paired-off-effect-smoke --environment hosted-plain-v1 \
  --json > "/tmp/t6-off-${RUN_TAG}.json" || OFF_RC=$?
echo "    OFF 侧 run 退出码：${OFF_RC}（有试题失败时为 1，属 T6 预期）"

echo "[2/3] ON 侧：paired-on-effect-smoke（157-159 挂万象术插件）"
SUT_ROOT="${SUT_ROOT:-/Users/Licw/Desktop/git/wanxiangshu}" \
ON_RC=0
npx tsx src/cli/main.ts run --project examples/product-eval \
  --dataset paired-on-effect-smoke --environment hosted-plugin-v1 \
  --json > "/tmp/t6-on-${RUN_TAG}.json" || ON_RC=$?
echo "    ON 侧 run 退出码：${ON_RC}"

# JSON 产物缺失说明 run 连启动都没成功（参数/环境错误），此时才应中止
[ -s "/tmp/t6-off-${RUN_TAG}.json" ] || { echo "OFF 侧无 JSON 产物，中止"; exit "${OFF_RC}"; }
[ -s "/tmp/t6-on-${RUN_TAG}.json" ] || { echo "ON 侧无 JSON 产物，中止"; exit "${ON_RC}"; }

echo "[3/3] 汇总两侧 pass_rate"
python3 - "$RUN_TAG" << 'PY'
import json, sys
tag = sys.argv[1]

def summarize(path, side):
    with open(path) as f:
        d = json.load(f)
    items = d.get('results', [])
    total = len(items)
    passed = sum(1 for r in items if r.get('pass'))
    rate = (passed / total) if total else 0.0
    print(f"{side}: pass {passed}/{total} (rate={rate:.2f})")
    for r in items:
        print(f"   {r.get('item_id')}  pass={r.get('pass')}  attribution={r.get('attribution')}")
    return rate

off = summarize(f"/tmp/t6-off-{tag}.json", 'OFF')
on  = summarize(f"/tmp/t6-on-{tag}.json",  'ON ')
print(f"\nΔ (ON - OFF) = {on - off:+.2f}")
if on > off:
    print("→ 插件侧通过率更高，方向符合「ON 有机会过」的 DoD 预期")
elif on == off:
    print("→ 两侧持平，需查题面区分度是否足够")
else:
    print("→ ON 低于 OFF，优先查编排链与沙箱日志，勿直接下「插件负收益」结论")
PY

echo "产物：/tmp/t6-off-${RUN_TAG}.json 与 /tmp/t6-on-${RUN_TAG}.json"
echo "（正式对照报告由 CLI compare 生成，跑完两侧后执行："
echo "  npx tsx src/cli/main.ts compare --baseline <OFF run_dir> --candidate <ON run_dir>）"
