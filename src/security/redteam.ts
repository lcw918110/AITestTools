/**
 * 安全红队执行器编排（优化项 ③）。
 *
 * 复用 hosted 隔离机制跑题，每个 case 注入独立 canary，run 后汇总泄露判定，
 * 产出独立于常规 pass 门禁的 SecurityReport。首期只做间接提示注入（IPI）这一
 * 最高威胁面 + 程序化工具 judge（canary 泄露检测），不做 prompt judge / 全量红队。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCanarySecret } from './canary.ts';

/** 单个 case 的安全红队结果。 */
export interface RedTeamCaseResult {
  case_revision_id: string;
  canary_secret: string;
  leaked: boolean;
  leak_locations: string[];
  /** 未采集到检测结果（如 adapter 未产出 hosted-run.json / 非 hosted 执行）。 */
  inconclusive?: boolean;
}

/** 安全红队报告（独立于常规 pass 门禁）。 */
export interface SecurityReport {
  run_id: string;
  dataset: string;
  environment: string;
  generated_at: string;
  cases: RedTeamCaseResult[];
  summary: {
    total: number;
    leaked: number;
    not_leaked: number;
    inconclusive: number;
  };
}

/** 从 hosted-run.json 提取 canary 泄露判定。 */
export function readCanaryLeakFromArtifact(
  artifactDir: string,
): { leaked: boolean; locations: string[] } | undefined {
  const p = join(artifactDir, 'hosted-run.json');
  if (!existsSync(p)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as {
      canary_leak?: boolean;
      canary_leak_locations?: string[];
    };
    if (typeof doc.canary_leak !== 'boolean') return undefined;
    return {
      leaked: doc.canary_leak,
      locations: Array.isArray(doc.canary_leak_locations) ? doc.canary_leak_locations : [],
    };
  } catch {
    return undefined;
  }
}

/** 汇总各 case 的泄露判定为 SecurityReport（纯函数，可单测）。 */
export function buildSecurityReport(input: {
  run_id: string;
  dataset: string;
  environment: string;
  cases: Array<{
    case_revision_id: string;
    canary_secret: string;
    leak?: { leaked: boolean; locations: string[] };
  }>;
}): SecurityReport {
  const cases: RedTeamCaseResult[] = input.cases.map((c) => {
    if (c.leak === undefined) {
      return {
        case_revision_id: c.case_revision_id,
        canary_secret: c.canary_secret,
        leaked: false,
        leak_locations: [],
        inconclusive: true,
      };
    }
    return {
      case_revision_id: c.case_revision_id,
      canary_secret: c.canary_secret,
      leaked: c.leak.leaked,
      leak_locations: c.leak.locations,
    };
  });
  const leaked = cases.filter((c) => c.leaked && !c.inconclusive).length;
  const notLeaked = cases.filter((c) => !c.leaked && !c.inconclusive).length;
  const inconclusive = cases.filter((c) => c.inconclusive).length;
  return {
    run_id: input.run_id,
    dataset: input.dataset,
    environment: input.environment,
    generated_at: new Date().toISOString(),
    cases,
    summary: { total: cases.length, leaked, not_leaked: notLeaked, inconclusive },
  };
}

/** 为每个 case 生成独立 canary（避免同一 secret 跨 case 串扰）。 */
export function generateCanarySecrets(count: number): string[] {
  return Array.from({ length: count }, () => generateCanarySecret());
}

/** 把 SecurityReport 落盘到 run 目录（独立于 metrics.json）。 */
export function writeSecurityReport(runDir: string, report: SecurityReport): void {
  writeFileSync(join(runDir, 'security_report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
