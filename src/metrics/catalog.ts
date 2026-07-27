import type { Axis } from '../exam-engine/types.ts';

export interface MetricSpec {
  name: string;
  axis: Axis;
  meaning: string;
  aggregation: 'mean' | 'sum';
  higher_is_better: boolean;
  /** hosted 通道指标恒为 false：PRD §5.2 要求引擎层面无法把它配成门禁。 */
  gateable: boolean;
}

/** PRD 附录 C 指标目录。新增指标必须先进这张表，再被 suite 的 gates 引用。 */
export const METRIC_CATALOG: readonly MetricSpec[] = [
  {
    name: 'a_case_pass_rate',
    axis: 'A',
    meaning: 'active case 通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'a_invariant_violations',
    axis: 'A',
    meaning: 'PROTOCOL/CONTEXT 归因数',
    aggregation: 'sum',
    higher_is_better: false,
    gateable: true,
  },
  {
    name: 'a_recovery_pass_rate',
    axis: 'A',
    meaning: '重启/重放类通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'a_concurrency_pass_rate',
    axis: 'A',
    meaning: '竞争类通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'a_flaky_rerun_delta',
    axis: 'A',
    meaning: '同配置重跑不一致数',
    aggregation: 'sum',
    higher_is_better: false,
    gateable: true,
  },
  {
    name: 'b_task_pass_rate',
    axis: 'B',
    meaning: '任务断言通过率（按通道分列）',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: false,
  },
  {
    name: 'b_schema_obedience_rate',
    axis: 'B',
    meaning: 'schema/必调工具服从率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'b_required_tool_call_rate',
    axis: 'B',
    meaning: '必选工具实际调用率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'b_invalid_args_rate',
    axis: 'B',
    meaning: '工具参数非法率',
    aggregation: 'mean',
    higher_is_better: false,
    gateable: true,
  },
  {
    name: 'b_avg_steps_to_success',
    axis: 'B',
    meaning: '成功路径平均步数',
    aggregation: 'mean',
    higher_is_better: false,
    gateable: false,
  },
  {
    name: 'b_cost_tokens_per_pass',
    axis: 'B',
    meaning: '每成功 case 平均 token',
    aggregation: 'mean',
    higher_is_better: false,
    gateable: false,
  },
  {
    name: 'b_refusal_or_empty_rate',
    axis: 'B',
    meaning: '拒答/空输出率',
    aggregation: 'mean',
    higher_is_better: false,
    gateable: true,
  },
  {
    name: 'b_hosted_attribution_share',
    axis: 'B',
    meaning: 'hosted 失败归因占比分布',
    aggregation: 'mean',
    higher_is_better: false,
    gateable: false,
  },
  {
    name: 'c_contract_pass_rate',
    axis: 'C',
    meaning: '直调契约通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'c_boundary_pass_rate',
    axis: 'C',
    meaning: '边界/非法输入通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'c_idempotent_pass_rate',
    axis: 'C',
    meaning: '幂等类通过率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'c_timeout_truncate_correct',
    axis: 'C',
    meaning: '超时/截断标记正确率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
  {
    name: 'c_via_agent_discover_rate',
    axis: 'C',
    meaning: '经 Agent 发现并正确调用率',
    aggregation: 'mean',
    higher_is_better: true,
    gateable: true,
  },
];

const BY_NAME = new Map(METRIC_CATALOG.map((m) => [m.name, m]));

export function findMetric(name: string): MetricSpec | undefined {
  return BY_NAME.get(name);
}

/** hosted 指标不可挂门禁：既拦目录内标记 gateable=false 的，也拦一切 hosted 前缀的新指标。 */
export function isGateable(name: string): boolean {
  if (name.startsWith('b_hosted') || name.includes('_hosted_')) return false;
  return findMetric(name)?.gateable ?? true;
}
