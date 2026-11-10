/**
 * 挂插件一侧的受管 agent 清单必须与插件认知一致。
 *
 * 2026-11-09 实测：万象术插件 `ManagedAgentConfig.validate` 会 `rejectLegacy`
 * （`coder` / `inspector` / `browser` / `inquiry` / `distiller` 等 legacy 名直接 fatal），
 * 并按它自己的固定 `requiredNames` 强制接管 agent 条目；admission 层还要求根会话
 * agent 与插件认知一致，否则 `InvalidExplicitAgent`。
 *
 * 也就是说 ON 侧的 `host_agent` / `managed_agents` 没有选择余地。本测试锁住
 * 所有挂插件的环境清单与插件实际要求一致，避免它们再悄悄偏离。
 *
 * 历史事故证据（实测产物）：
 *   - `runs/20260922-212305026-saug` 报 `managed-agent-config-invalid`
 *   - `runs/20260922-021713984-mos8` 报 `InvalidExplicitAgent`
 * 均因插件环境用了 `fast-*` 角色名。
 *
 * 插件权威清单来源（实测 `wanxiangli/identity` 的 `Identity.activeRoleLabels()`）：
 *   activeRoleLabels = ['orchestrator', 'manager', 'engineer', 'devops', 'plan']
 *   requiredNames    = activeRoleLabels + ['bookkeeper']
 * 该清单随插件升级可能变化，变化时本测试会红，提示重新核对而非静默漂移。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 插件实测要求的受管 agent 清单（顺序即插件 catalog 顺序）。 */
const PLUGIN_REQUIRED_AGENTS = [
  'orchestrator',
  'manager',
  'engineer',
  'devops',
  'plan',
  'bookkeeper',
] as const;

/** 插件明确拒绝的 legacy 名（`rejectLegacy` 会 fatal）。 */
const PLUGIN_LEGACY_AGENTS = [
  'coder',
  'inspector',
  'browser',
  'inquiry',
  'distiller',
  'build',
  'student',
  'teacher',
  'meditator',
  'executor',
] as const;

interface EnvDoc {
  environment_profile_id?: string;
  recipe?: {
    host_agent?: string;
    managed_agents?: string[];
    host_plugin?: string;
  };
}

/** 扫描 examples/*\/environments 下所有挂插件的环境。 */
function pluginEnvironments(): Array<{ file: string; doc: EnvDoc }> {
  const examplesRoot = join(process.cwd(), 'examples');
  const out: Array<{ file: string; doc: EnvDoc }> = [];
  for (const project of readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const envDir = join(examplesRoot, project.name, 'environments');
    let files: string[];
    try {
      files = readdirSync(envDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.environment.json')) continue;
      const doc = JSON.parse(readFileSync(join(envDir, file), 'utf8')) as EnvDoc;
      if (doc.recipe?.host_plugin !== undefined) {
        out.push({ file: `${project.name}/environments/${file}`, doc });
      }
    }
  }
  return out;
}

describe('所有挂插件环境的受管 agent 清单', () => {
  const envs = pluginEnvironments();

  it('至少能扫到一个挂插件的环境（防止扫描逻辑失效导致空跑假绿）', () => {
    expect(envs.length).toBeGreaterThan(0);
  });

  for (const { file, doc } of pluginEnvironments()) {
    describe(file, () => {
      const recipe = doc.recipe ?? {};
      const agents = recipe.managed_agents ?? [];

      it('managed_agents 与插件 requiredNames 完全一致', () => {
        expect([...agents].sort()).toEqual([...PLUGIN_REQUIRED_AGENTS].sort());
      });

      it('不含已 retired 的 blogger / predictor', () => {
        expect(agents).not.toContain('blogger');
        expect(agents).not.toContain('predictor');
      });

      it('不含任何插件会 fatal 拒绝的 legacy 名', () => {
        for (const legacy of PLUGIN_LEGACY_AGENTS) {
          expect(agents).not.toContain(legacy);
        }
      });

      it('不含 fast- / deep- 前缀名（拆词后 fallback 解析失败会 fatal）', () => {
        for (const name of agents) {
          expect(name.startsWith('fast-')).toBe(false);
          expect(name.startsWith('deep-')).toBe(false);
        }
      });

      it('host_agent 是清单内的角色（否则 admission 报 InvalidExplicitAgent）', () => {
        expect(recipe.host_agent).toBeDefined();
        expect(agents).toContain(recipe.host_agent);
      });
    });
  }
});
