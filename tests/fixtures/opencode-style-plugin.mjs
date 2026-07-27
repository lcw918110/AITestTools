/**
 * 测试夹具：opencode-v1 hook_style。
 * 连续两次 session.idle 且无工具进展 → nudge_dispatched。
 */
export function plugin(ctx) {
  return {
    async event(input) {
      const ev = input?.event ?? input ?? {};
      const type = ev.type ?? ev.name;
      if (type !== 'session.idle') return;
      const props = ev.properties ?? {};
      const streak = Number(props.no_progress_streak ?? 0);
      const session = ctx.getSession();
      if (streak >= 2 && !(session.nudge_count > 0)) {
        ctx.emit({ type: 'nudge_dispatched', kind: 'nudge_dispatched', reason: 'no_progress' });
        ctx.patchSession({ nudge_count: (session.nudge_count ?? 0) + 1 });
      }
    },
    async 'tool.execute.after'(input) {
      if (input?.tool !== 'submit_review') return;
      const report = input.args?.report;
      if (typeof report !== 'string' || report.length === 0) {
        ctx.setToolOk(false);
        ctx.emit({ type: 'review_rejected', kind: 'review_rejected' });
        return;
      }
      ctx.emit({ type: 'review_verdict', kind: 'review_verdict', verdict: 'accepted' });
      ctx.patchSession({ review: { required: false, verdict: 'accepted' } });
    },
  };
}

export default plugin;
