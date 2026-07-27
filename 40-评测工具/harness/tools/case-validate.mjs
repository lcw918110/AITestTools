#!/usr/bin/env node
// 零依赖用例校验器（Phase 0）。用法：
//   node "systenstest/40-评测工具/harness/tools/case-validate.mjs" [file.case.json ...]
// 不带参数时校验本骨架 cases/**/*.case.json 全部文件（路径相对脚本自身解析）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AXES = new Set(["A", "B", "C", "AB", "AC", "BC"]);
const STATUSES = new Set(["active", "draft", "deprecated"]);
const ATTRIBUTIONS = new Set(["PROTOCOL", "CONTEXT", "MODEL_SCHEMA", "MODEL_TASK", "TOOL", "HARNESS"]);
// B/C 轴沿用 v1 freeze 形状；A 轴按 PRD v2 三层结构（layer 决定必填项）
const FREEZE_FIELDS_BC = ["model_driver", "model_id", "host_profile", "tool_profile", "prompt_template"];
const A_LAYERS = new Set(["L1", "L2", "L3"]);
const ORACLE_TYPES = new Set([
  "event_fold", "event_subsequence", "state_predicate", "no_event",
  "tool_trace", "schema_obedience", "workspace_assert",
  "tool_result_equals", "tool_side_effect", "exit_code", "metric_threshold",
]);

function collectCaseFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectCaseFiles(full));
    else if (entry.endsWith(".case.json")) found.push(full);
  }
  return found;
}

function validate(file) {
  const errors = [];
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return [`JSON 解析失败: ${e.message}`];
  }
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(typeof doc.id === "string" && /^[A-Z]+[A-Z0-9-]*$/.test(doc.id), "id 缺失或格式非法（大写字母数字连字符）");
  need(Number.isInteger(doc.rev) && doc.rev >= 1, "rev 必须为 >=1 的整数");
  need(AXES.has(doc.axis), `axis 必须是 ${[...AXES].join("|")}`);
  need(STATUSES.has(doc.status), `status 必须是 ${[...STATUSES].join("|")}`);
  need(typeof doc.title === "string" && doc.title.length > 0, "title 缺失");
  need(doc.intent && typeof doc.intent.statement === "string", "intent.statement 缺失");
  need(doc.intent && ATTRIBUTIONS.has(doc.intent.attribution_focus), "intent.attribution_focus 非法");

  need(doc.freeze && typeof doc.freeze === "object", "freeze 缺失");
  const fz = doc.freeze ?? {};
  const strField = (name) => typeof fz[name] === "string" && fz[name].length > 0;
  if (doc.axis === "A") {
    need(A_LAYERS.has(fz.layer), "A 轴 freeze.layer 必须是 L1|L2|L3（PRD v2）");
    if (fz.layer === "L1") {
      need(strField("fold_entry"), "L1 用例 freeze.fold_entry 必填");
      need(fz.model_driver === "none", "L1 用例 freeze.model_driver 必须为 none（零模型直测）");
      need(!strField("contract") && !strField("script"), "L1 用例禁填 contract/script");
    }
    if (fz.layer === "L2") {
      need(strField("contract"), "L2 用例 freeze.contract 必填");
      need(fz.model_driver === "scripted", "L2 用例 freeze.model_driver 必须为 scripted");
      need(strField("script"), "L2 用例 freeze.script 必填（剧本文件）");
    }
    if (fz.layer === "L3") {
      need(strField("contract"), "L3 用例 freeze.contract 必填");
      need(strField("cassette"), "L3 用例 freeze.cassette 必填");
      need(fz.model_driver === "as-recorded", "L3 用例 freeze.model_driver 必须为 as-recorded");
    }
  } else if (doc.freeze) {
    for (const f of FREEZE_FIELDS_BC) need(strField(f), `freeze.${f} 缺失`);
  }

  need(doc.stimulus && typeof doc.stimulus.kind === "string", "stimulus.kind 缺失");
  need(doc.stimulus && typeof doc.stimulus.ref === "string", "stimulus.ref 缺失");

  const oracles = doc.expect && Array.isArray(doc.expect.oracles) ? doc.expect.oracles : null;
  need(oracles && oracles.length > 0, "expect.oracles 至少 1 条");
  for (const [i, o] of (oracles ?? []).entries()) {
    need(o && ORACLE_TYPES.has(o.type), `expect.oracles[${i}].type 非法或缺失`);
  }

  need(doc.metrics && Array.isArray(doc.metrics.primary) && doc.metrics.primary.length > 0, "metrics.primary 至少 1 项");
  need(doc.execution && Number.isInteger(doc.execution.deadline_ms) && doc.execution.deadline_ms > 0, "execution.deadline_ms 必须为正整数");
  need(doc.execution && typeof doc.execution.requires_network === "boolean", "execution.requires_network 缺失");

  const raw = readFileSync(file, "utf8");
  if (/"sleep_ms"/.test(raw) && !/"harness_internal"/.test(raw)) {
    errors.push("发现裸 sleep_ms 且未标 harness_internal（时间无关原则）");
  }
  return errors;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const casesDir = resolve(scriptDir, "..", "cases");
const targets = process.argv.slice(2).length ? process.argv.slice(2).map((p) => resolve(p)) : collectCaseFiles(casesDir);

let failed = 0;
for (const file of targets) {
  const errors = validate(file);
  if (errors.length === 0) {
    console.log(`PASS  ${file}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${file}`);
    for (const e of errors) console.error(`      - ${e}`);
  }
}
console.log(`\n${targets.length - failed}/${targets.length} case(s) valid`);
process.exit(failed === 0 ? 0 : 1);
