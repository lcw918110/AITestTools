#!/usr/bin/env bash
# 从被测仓同步 papers 到引擎本地副本（排除 runs）。
# 用法：
#   SUT_ROOT=../wanxiangshu npm run sync:papers
#   ./scripts/sync-sut-papers.sh /path/to/wanxiangshu
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUT="${1:-${SUT_ROOT:-}}"
if [[ -z "$SUT" ]]; then
  echo "用法：SUT_ROOT=<被测仓根> $0   或   $0 <被测仓根>" >&2
  exit 2
fi
SUT="$(cd "$SUT" && pwd)"
SRC="$SUT/papers"
DST="$ROOT/examples/wanxiangshu-papers"
if [[ ! -d "$SRC" ]]; then
  echo "找不到题库：$SRC" >&2
  exit 1
fi
mkdir -p "$DST"
rsync -a --delete \
  --exclude 'runs/' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  "$SRC/" "$DST/"
rm -rf "$DST/runs"
echo "已同步：$SRC → $DST"
echo "运行示例：SUT_ROOT=$SUT npm run proctor -- run --axis A --paperset st-import-L1 --project examples/wanxiangshu-papers"
