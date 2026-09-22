#!/usr/bin/env bash
# 操作台 L0 冒烟（对照 docs/test/03-console-ops.md §1，含 C-B-30～34）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PROCTOR_CONSOLE_PORT:-8799}"
BASE="http://127.0.0.1:${PORT}"
export PROCTOR_CONSOLE_PORT="$PORT"
export PROCTOR_CONSOLE_VERIFY_STUB=1
export BASE
export ROOT

npm run console >/tmp/proctor-console-l0.log 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -sf "$BASE/api/health" >/dev/null; then
    break
  fi
  sleep 0.25
done
curl -sf "$BASE/api/health" | grep -q '"ok": true'

curl -sf "$BASE/api/presets" | grep -q '"id": "plugin"'
curl -sf "$BASE/api/bank/tasks" | python3 -c 'import sys,json; d=json.load(sys.stdin); t=next(x for x in d["tasks"] if x["taskId"]=="PAIRED-TASK-02"); assert t.get("promptPreview"); assert "notes" in t'

# C-A-02 presets 含默认测试集
curl -sf "$BASE/api/presets" | python3 -c 'import sys,json; d=json.load(sys.stdin); ps={p["id"]:p for p in d["presets"]}; assert ps["plugin"]["defaultExamMode"]=="both"; assert ps["model"]["defaultPaperset"]=="paired-off"; assert ps["model"]["defaultTestSetId"]=="full"'

# C-A-03 / C-A-50 测试集不含 eval-model
curl -sf "$BASE/api/project" | python3 -c 'import sys,json; d=json.load(sys.stdin); ids={t["id"] for t in d["testSets"]}; assert "effect-smoke" in ids and "full" in ids and "eval-model" not in ids'
curl -sf "$BASE/api/test-sets" | python3 -c 'import sys,json; d=json.load(sys.stdin); ids={t["id"] for t in d["testSets"]}; assert "calibrate" in ids'

# C-A-51 catalog
curl -sf "$BASE/api/env/catalog" | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["models"] and d["agents"]'

# C-A-52 stub 验证
curl -sf -X POST "$BASE/api/env/verify" -H 'content-type: application/json' \
  -d '{"kind":"model","id":"wave-ai/gpt-5.4-mini"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("ok")'
curl -sf -X POST "$BASE/api/env/verify" -H 'content-type: application/json' \
  -d '{"kind":"agent","id":"fast-coder"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d.get("ok")'

JOB=$(curl -sf -X POST "$BASE/api/run" -H 'content-type: application/json' \
  -d '{"experiment":"plugin","live":false}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["jobId"])')
for _ in $(seq 1 60); do
  ST=$(curl -sf "$BASE/api/jobs/$JOB" | python3 -c 'import sys,json; j=json.load(sys.stdin); print(j["status"], j.get("exitCode",""))')
  case "$ST" in
    done\ 0) break ;;
    error*) echo "job failed: $ST"; exit 1 ;;
  esac
  sleep 0.5
done
echo "$ST" | grep -q '^done 0'

# C-A-14 / C-A-15 非法考场与空清单
CODE=$(curl -s -o /tmp/ca14.json -w '%{http_code}' -X POST "$BASE/api/run" \
  -H 'content-type: application/json' -d '{"experiment":"plugin","live":false,"examMode":"maybe"}')
test "$CODE" = "400"
CODE=$(curl -s -o /tmp/ca15.json -w '%{http_code}' -X POST "$BASE/api/run" \
  -H 'content-type: application/json' -d '{"experiment":"plugin","live":false,"taskIds":[]}')
test "$CODE" = "400"

# C-A-16 离线带选题仍只校验、不写回组卷
JOB2=$(curl -sf -X POST "$BASE/api/run" -H 'content-type: application/json' \
  -d '{"experiment":"plugin","live":false,"examMode":"both","testSetId":"effect-smoke","taskIds":["PAIRED-TASK-157"]}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["jobId"])')
for _ in $(seq 1 60); do
  ST=$(curl -sf "$BASE/api/jobs/$JOB2" | python3 -c 'import sys,json; j=json.load(sys.stdin); print(j["status"], j.get("exitCode",""))')
  case "$ST" in
    done\ 0) break ;;
    error*) echo "job2 failed: $ST"; exit 1 ;;
  esac
  sleep 0.5
done
echo "$ST" | grep -q '^done 0'

# C-A-17 测模型不能叠插件差
CODE=$(curl -s -o /tmp/ca17.json -w '%{http_code}' -X POST "$BASE/api/run" \
  -H 'content-type: application/json' -d '{"experiment":"model","live":false,"examMode":"both"}')
test "$CODE" = "400"
grep -q '测万象术' /tmp/ca17.json

# C-A-40～44 测试任务 CRUD
ET=$(curl -sf -X POST "$BASE/api/eval-tasks" -H 'content-type: application/json' \
  -d '{"name":"L0烟卷","kind":"plugin","testSetId":"effect-smoke","taskIds":["PAIRED-TASK-157"],"examMode":"both"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "$ET" | grep -q '^et-'
python3 - <<PY
import json, os, urllib.error, urllib.request
base = os.environ["BASE"]
et = """$ET"""
with urllib.request.urlopen(base + "/api/eval-tasks") as r:
    d = json.load(r)
assert any(t["id"] == et and t["taskIds"] == ["PAIRED-TASK-157"] for t in d["tasks"])
req = urllib.request.Request(
    base + "/api/eval-tasks/" + et,
    data=json.dumps({"name": "L0烟卷改名"}).encode(),
    headers={"content-type": "application/json"},
    method="PUT",
)
with urllib.request.urlopen(req) as r:
    d = json.load(r)
assert d["name"] == "L0烟卷改名"
req = urllib.request.Request(
    base + "/api/eval-tasks",
    data=json.dumps({"name": "L0模型", "kind": "model", "examMode": "both"}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    m = json.load(r)
assert m["kind"] == "model" and m["examMode"] == "off"
req = urllib.request.Request(
    base + "/api/eval-tasks/" + et,
    data=json.dumps({"kind": "agent"}).encode(),
    headers={"content-type": "application/json"},
    method="PUT",
)
try:
    urllib.request.urlopen(req)
    raise SystemExit("expected 400 when changing kind")
except urllib.error.HTTPError as e:
    assert e.code == 400
req = urllib.request.Request(base + "/api/eval-tasks/" + m["id"], method="DELETE")
with urllib.request.urlopen(req) as r:
    json.load(r)
req = urllib.request.Request(base + "/api/eval-tasks/" + et, method="DELETE")
with urllib.request.urlopen(req) as r:
    json.load(r)
print("eval-tasks CRUD OK")
PY

curl -sf -X POST "$BASE/api/bank/validate" | python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") and j.get("summary"); raise SystemExit(0)'

# C-B-30 终态词不在题干
CODE=$(curl -s -o /tmp/cb30.json -w '%{http_code}' -X POST "$BASE/api/bank/tasks" \
  -H 'content-type: application/json' \
  -d '{"taskId":"PAIRED-TASK-97","prompt":"Say hello.","passToken":"ACK"}')
test "$CODE" = "400"
grep -q '终态词' /tmp/cb30.json

# 新题拒绝 Text-only 题干
CODE=$(curl -s -o /tmp/cb-text.json -w '%{http_code}' -X POST "$BASE/api/bank/tasks" \
  -H 'content-type: application/json' \
  -d '{"taskId":"PAIRED-TASK-97","prompt":"Text-only reply. Seal with ACK.","passToken":"ACK"}')
test "$CODE" = "400"
grep -q 'Text-only' /tmp/cb-text.json

# C-B-34 题号非 PAIRED-TASK-NN
CODE=$(curl -s -o /tmp/cb34.json -w '%{http_code}' -X POST "$BASE/api/bank/tasks" \
  -H 'content-type: application/json' \
  -d '{"taskId":"PAIRED-TASK-L0TMP","prompt":"Reply with exactly X.","passToken":"X"}')
test "$CODE" = "400"

# C-B-31 PUT 无 changeName（对已有题）
CODE=$(curl -s -o /tmp/cb31.json -w '%{http_code}' -X PUT "$BASE/api/bank/tasks/PAIRED-TASK-02" \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly yes.\n","passToken":"yes"}')
test "$CODE" = "400"
grep -q '变更说明' /tmp/cb31.json

# C-B-33 DELETE 无 confirmId / 错号
CODE=$(curl -s -o /tmp/cb33a.json -w '%{http_code}' -X DELETE "$BASE/api/bank/tasks/PAIRED-TASK-02")
test "$CODE" = "400"
CODE=$(curl -s -o /tmp/cb33b.json -w '%{http_code}' -X DELETE "$BASE/api/bank/tasks/PAIRED-TASK-02" \
  -H 'content-type: application/json' -d '{"confirmId":"WRONG"}')
test "$CODE" = "400"

# 新建 + 删除闭环（下一空号；测完删除，不留脏题）
NEXT=$(curl -sf "$BASE/api/bank/tasks" | python3 -c 'import sys,json; print(json.load(sys.stdin)["nextTaskId"])')
TOKEN="L0SMOKE${NEXT#PAIRED-TASK-}"
curl -sf -X POST "$BASE/api/bank/tasks" -H 'content-type: application/json' \
  -d "{\"taskId\":\"$NEXT\",\"prompt\":\"Search the repo then seal with $TOKEN.\",\"passToken\":\"$TOKEN\",\"contains\":\"$TOKEN\",\"tags\":[\"coding\"],\"testSetId\":\"calibrate\"}" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); assert d["tags"]==["coding"]'
curl -sf -X DELETE "$BASE/api/bank/tasks/$NEXT" \
  -H 'content-type: application/json' \
  -d "{\"confirmId\":\"$NEXT\"}" | grep -q '"ok": true'
curl -sf -X POST "$BASE/api/bank/validate" | python3 -c 'import sys,json; j=json.load(sys.stdin); raise SystemExit(0 if j.get("ok") else 1)'

# 路径拒绝
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/runs/view?path=../../../etc/passwd")
test "$CODE" = "404"

# C-A-30 baselines 列表
curl -sf "$BASE/api/baselines" | python3 -c 'import sys,json; j=json.load(sys.stdin); assert "baselines" in j'

# C-A-21b / C-A-31：有 run 时校验 summary + pin/compare
python3 - <<'PY'
import json, os, urllib.parse, urllib.request, shutil
from pathlib import Path

base = os.environ["BASE"]
root = Path(os.environ["ROOT"])

def get(path: str):
    with urllib.request.urlopen(base + path) as r:
        return json.load(r)

def post(path: str, body: dict):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)

runs = get("/api/runs").get("runs") or []
if not runs:
    print("no runs; skip pin/compare")
    raise SystemExit(0)

run_path = runs[0]["path"]
q = urllib.parse.quote(run_path, safe="")
view = get(f"/api/runs/view?path={q}")
assert "summary" in view and "attribution" in view["summary"]
assert "fail_total" in view["summary"]["attribution"]
assert "dashboard" in view and "config" in view["dashboard"] and "headline" in view["dashboard"]

pin_name = "l0-console-smoke"
pin = post("/api/baselines/pin", {"runPath": run_path, "name": pin_name})
assert pin.get("ok") and pin.get("name") == pin_name

cmp = post("/api/compare", {"baseline": pin_name, "candidate": run_path, "writeMd": False})
assert cmp.get("ok") and "report" in cmp and "effect" in cmp["report"]

shutil.rmtree(root / "examples/product-eval/baselines" / pin_name, ignore_errors=True)
print("baselines pin/compare OK")
PY

echo "console L0 OK (port $PORT)"
