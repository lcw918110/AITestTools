/**
 * L2 控制流插件（opencode-v1 hook_style）。
 *
 * 这不是完整万象术 OpenCode Plugin 的替代品：完整 Plugin 依赖真宿主 ctx/MCP/工具面。
 * 本文件按官方 hook 名接收假宿主派发，用万象术事件 Kind（snake_case）写 timeline，
 * 供 agent-proctor 在零真宿主下测 nudge / review 协议时序。
 *
 * 真 Plugin 路径：build/src/Opencode/Plugin.js（或重建后 Hosts/OpenCode/Plugin.js）。
 */
export function plugin(ctx) {
  return {
    async 'chat.message'() {
      /* 绑定轮次：假宿主冒烟不强制 */
    },

    async 'tool.execute.before'() {},

    async 'tool.execute.after'(input) {
      if (input?.tool !== 'submit_review') return;
      const report = input.args?.report;
      if (typeof report !== 'string' || report.length === 0) {
        ctx.setToolOk(false);
        ctx.emit({
          type: 'submit_review_rejected',
          kind: 'submit_review_rejected',
          reason: 'empty_report',
        });
        return;
      }
      // 对齐内核：终态 accepted 关闭审查
      ctx.emit({
        type: 'review_verdict',
        kind: 'review_verdict',
        verdict: 'accepted',
        Payload: { verdict: 'accepted' },
      });
      ctx.patchSession({
        review: { required: false, verdict: 'accepted' },
      });
    },

    async event(input) {
      const ev = input?.event ?? input ?? {};
      const type = ev.type ?? ev.name;
      // 假宿主在每轮结束后派发 session.idle（对齐万象术 natural-stop）
      if (type !== 'session.idle') return;
      const streak = Number(ev.properties?.no_progress_streak ?? 0);
      const session = ctx.getSession();
      const already = Number(session.nudge_count ?? 0) > 0;
      if (streak >= 2 && !already) {
        ctx.emit({
          type: 'nudge_dispatched',
          kind: 'nudge_dispatched',
          reason: 'no_progress',
          Payload: { anchor: `idle:${streak}` },
        });
        ctx.patchSession({ nudge_count: Number(session.nudge_count ?? 0) + 1 });
      }
    },
  };
}

export default plugin;
