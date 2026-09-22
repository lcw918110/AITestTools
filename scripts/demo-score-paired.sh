#!/usr/bin/env bash
# 在已有 paired 基线 / candidate run 上写入参考分并 compare，演示分差与配对表。
# 用法：
#   BASE=examples/product-eval/baselines/paired-off \
#   CAND=examples/product-eval/runs/<on-run-id> \
#   bash scripts/demo-score-paired.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROCTOR=(npm run proctor --)

BASE="${BASE:-examples/product-eval/baselines/paired-off}"
CAND="${CAND:-}"
if [[ -z "$CAND" ]]; then
  CAND="$(ls -1dt examples/product-eval/runs/*/ 2>/dev/null | head -1 | sed 's:/$::')"
fi
if [[ -z "$CAND" || ! -f "$CAND/results.ndjson" ]]; then
  echo "请设置 CAND=paired-on 的 run 目录" >&2
  exit 2
fi

echo "== 参考分写入（量表 5；示意：off 偏低 / on 偏高；见 protocol/rubrics/effect-v1.json）=="
# baseline（无插件）
declare -a OFF_SCORES=(
  "EVAL-B-PAIRED-TASK-OFF:3"
  "EVAL-B-PAIRED-TASK-02-OFF:3"
  "EVAL-B-PAIRED-TASK-03-OFF:2"
  "EVAL-B-PAIRED-TASK-04-OFF:3"
  "EVAL-B-PAIRED-TASK-05-OFF:2"
)
for entry in "${OFF_SCORES[@]}"; do
  id="${entry%%:*}"
  val="${entry##*:}"
  "${PROCTOR[@]}" score write --run "$BASE" --item "$id" --value "$val" --max 5 --name "人工示意：无插件"
done

# candidate（有插件）
declare -a ON_SCORES=(
  "EVAL-B-PAIRED-TASK-ON:4"
  "EVAL-B-PAIRED-TASK-02-ON:4"
  "EVAL-B-PAIRED-TASK-03-ON:4"
  "EVAL-B-PAIRED-TASK-04-ON:5"
  "EVAL-B-PAIRED-TASK-05-ON:4"
)
for entry in "${ON_SCORES[@]}"; do
  id="${entry%%:*}"
  val="${entry##*:}"
  "${PROCTOR[@]}" score write --run "$CAND" --item "$id" --value "$val" --max 5 --name "人工示意：有插件"
done

echo "== compare（含参考分均分差 + 配对效果表）=="
"${PROCTOR[@]}" compare --baseline "$BASE" --candidate "$CAND"
echo "可读 $CAND/effect_compare.md（章节：配对效果 off ↔ on）"
