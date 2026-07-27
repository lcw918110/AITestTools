/**
 * agent-proctor 公共入口。
 *
 * 引擎不持有被测项目资产：试题 / 试卷 / 考场由使用方以 papers-v1 考卷库持有，
 * 引擎只负责按协议装载、校验、执行与出指标。
 */
export * from './exam-engine/index.ts';
export { METRIC_CATALOG, findMetric, isGateable, type MetricSpec } from './metrics/catalog.ts';
export { formatValidationReport } from './report/format.ts';
