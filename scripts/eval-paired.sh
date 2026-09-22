#!/usr/bin/env bash
# 产品评测：校验 1+3 题库；离线跑 demo schema fixture；PROCTOR_EVAL_LIVE=1 时配对直播。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/bin:${PATH:-}"
PROJECT=examples/product-eval
PROCTOR=(npm run proctor --)

echo "== 校验 product-eval（bank + rooms + papersets）=="
"${PROCTOR[@]}" item validate --project "$PROJECT" --check-fixtures

echo "== 离线：demo schema fixture（工程服从率；非产品效果题）=="
"${PROCTOR[@]}" item validate --project examples/demo-project --check-fixtures
"${PROCTOR[@]}" run --axis B --paperset eval-model --project examples/demo-project

if [[ "${PROCTOR_EVAL_LIVE:-}" != "1" ]]; then
  echo "已跳过直播。产品三对象同题："
  echo "  测模型：  npm run eval:model   # 或 PROCTOR_HOSTED_MODEL=… / paperset eval-model-alt"
  echo "  有无插件：SUT_ROOT=… PROCTOR_EVAL_LIVE=1 npm run eval:paired"
  echo "  测 Agent：npm run proctor -- run --axis B --paperset eval-agent --project $PROJECT"
  exit 0
fi

if [[ -z "${SUT_ROOT:-}" ]]; then
  echo "PROCTOR_EVAL_LIVE=1 需要 SUT_ROOT=被测仓根" >&2
  exit 2
fi

unset PROCTOR_HOSTED_PLUGIN || true

echo "== 直播：paired-off（无插件）=="
OFF_OUT="$("${PROCTOR[@]}" run --axis B --paperset paired-off --project "$PROJECT" 2>&1)"
echo "$OFF_OUT"
OFF_DIR="$(echo "$OFF_OUT" | sed -n 's/^run 完成：//p' | tail -1)"
if [[ -z "$OFF_DIR" ]]; then
  echo "未解析到 off run 目录" >&2
  exit 1
fi
"${PROCTOR[@]}" baseline pin --run "$OFF_DIR" --name paired-off --project "$PROJECT"

echo "== 直播：paired-on（有插件）=="
ON_OUT="$("${PROCTOR[@]}" run --axis B --paperset paired-on --project "$PROJECT" 2>&1)"
echo "$ON_OUT"
ON_DIR="$(echo "$ON_OUT" | sed -n 's/^run 完成：//p' | tail -1)"
if [[ -z "$ON_DIR" ]]; then
  echo "未解析到 on run 目录" >&2
  exit 1
fi

echo "== compare + 效果对照 =="
"${PROCTOR[@]}" compare --baseline "$PROJECT/baselines/paired-off" --candidate "$ON_DIR"
echo "完成。可读 $ON_DIR/effect_compare.md；参考分：npm run eval:score-demo"
