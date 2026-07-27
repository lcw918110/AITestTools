/**
 * demo 控制流插件：覆盖 L2 最小面（nudge 时机 + review 闭环）。
 * 假宿主通过动态 import 加载；真实被测插件不应放在本仓库。
 *
 * ── 接入万象术（WANXIANGSHU_HOOKUP）──
 * 1. 本文件的 `afterTurn` / `onToolAfter` 是 **demo 假接口**，不是 OpenCode 官方 Hooks。
 * 2. 真插件：`$SUT_ROOT/build/src/Opencode/Plugin.js`（或重建后 `Hosts/OpenCode/Plugin.js`）。
 * 3. L1 真 Fold 已接入：`examples/wanxiangshu-papers` + `adapters/fold-bridge.mjs`（见 design/21）。
 * 4. L2：须把 runner/假宿主改为触发 `event` / `tool.execute.after` / `chat.message`，
 *    或写薄适配层；不可把本 demo 导出名直接换成真 Plugin。
 * 5. 事件名：万象术用 `nudge_dispatched` / `review_verdict` 等（snake_case Kind），
 *    与本 demo 的 `NudgeEmitted` / `ReviewSubmitted` 不同。
 */

/** 连续无工具进展达到 2 次 → NudgeEmitted（须落在两轮之间）。 */
export function afterTurn(state) {
  const noProgress = state.no_progress_streak ?? 0;
  const already = (state.session?.nudge_count ?? 0) > 0;
  if (noProgress >= 2 && !already) {
    return {
      events: [{ type: 'NudgeEmitted', reason: 'no_progress' }],
      session_patch: { nudge_count: (state.session?.nudge_count ?? 0) + 1 },
    };
  }
  return { events: [], session_patch: {} };
}

/**
 * submit_review 成功 → 关闭审查投影。
 * 若在 required=true 时收到非法 Finish 语义，可发 SessionSettledWithoutReview（本 demo 不模拟错误路径）。
 */
export function onToolAfter(ctx) {
  if (ctx.tool !== 'submit_review') {
    return { events: [], session_patch: {}, tool_ok: true };
  }
  const report = ctx.args?.report;
  const ok = typeof report === 'string' && report.length > 0;
  if (!ok) {
    return {
      events: [{ type: 'ReviewRejected', reason: 'empty_report' }],
      session_patch: {},
      tool_ok: false,
    };
  }
  return {
    events: [
      { type: 'ReviewSubmitted', tool: 'submit_review' },
      { type: 'ReviewClosed', verdict: 'Passed' },
    ],
    session_patch: {
      review: { required: false, verdict: 'Passed' },
    },
    tool_ok: true,
  };
}
