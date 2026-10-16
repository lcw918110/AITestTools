import { describe, expect, it } from 'vitest';
import { findMetric, isGateable, METRIC_CATALOG } from '../../src/metrics/catalog.ts';

// ============================================================
// findMetric 边界
// ============================================================

describe('findMetric', () => {
  it('存在的指标名返回完整的 MetricSpec', () => {
    const spec = findMetric('a_case_pass_rate');
    expect(spec).toBeDefined();
    // 验证返回的是同一个引用（BY_NAME 做了 Map 查找）
    expect(spec!.name).toBe('a_case_pass_rate');
    expect(spec!.axis).toBe('A');
    expect(spec!.aggregation).toBe('mean');
    expect(spec!.higher_is_better).toBe(true);
    expect(spec!.gateable).toBe(true);
  });

  it('gateable=false 的目录指标也可被 find', () => {
    const spec = findMetric('b_task_pass_rate');
    expect(spec).toBeDefined();
    expect(spec!.name).toBe('b_task_pass_rate');
    expect(spec!.gateable).toBe(false);
  });

  it('不存在的指标名返回 undefined', () => {
    expect(findMetric('nonexistent_metric')).toBeUndefined();
    expect(findMetric('')).toBeUndefined(); // 空字符串
  });

  it('大小写敏感——大写变体找不到', () => {
    // 目录内的名字全是小写 + 下划线
    expect(findMetric('A_CASE_PASS_RATE')).toBeUndefined();
    expect(findMetric('A_case_pass_rate')).toBeUndefined();
  });

  it('命名变体（多余前缀/后缀）找不到', () => {
    expect(findMetric('_a_case_pass_rate')).toBeUndefined();
    expect(findMetric('a_case_pass_rate_')).toBeUndefined();
    expect(findMetric('a-case-pass-rate')).toBeUndefined(); // 横线 vs 下划线
  });

  it('目录内所有 18 个指标都能被 findMetric 查到', () => {
    for (const m of METRIC_CATALOG) {
      const spec = findMetric(m.name);
      expect(spec, `指标 "${m.name}" 应能查到`).toBeDefined();
      expect(spec).toBe(m); // 返回同一个对象引用
    }
  });
});

// ============================================================
// isGateable 所有分支
// ============================================================

describe('isGateable', () => {
  describe('目录内 gateable: true 的指标', () => {
    it('a_case_pass_rate → true', () => {
      expect(isGateable('a_case_pass_rate')).toBe(true);
    });

    it('a_invariant_violations → true', () => {
      expect(isGateable('a_invariant_violations')).toBe(true);
    });

    it('b_schema_obedience_rate → true', () => {
      expect(isGateable('b_schema_obedience_rate')).toBe(true);
    });

    it('c_contract_pass_rate → true', () => {
      expect(isGateable('c_contract_pass_rate')).toBe(true);
    });
  });

  describe('目录内 gateable: false 的指标', () => {
    it('b_task_pass_rate → false（非 hosted 但 gateable=false）', () => {
      expect(isGateable('b_task_pass_rate')).toBe(false);
    });

    it('b_avg_steps_to_success → false', () => {
      expect(isGateable('b_avg_steps_to_success')).toBe(false);
    });

    it('b_cost_tokens_per_pass → false', () => {
      expect(isGateable('b_cost_tokens_per_pass')).toBe(false);
    });

    it('b_hosted_attribution_share → false（同时命中 hosted 前缀和 gateable=false）', () => {
      // b_hosted_attribution_share 以 b_hosted 开头，也满足 _hosted_ 包含，
      // 且 gateable: false。任一分支都返回 false。
      expect(isGateable('b_hosted_attribution_share')).toBe(false);
    });
  });

  describe('hosted 通道指标强制不可门禁', () => {
    it('b_hosted 前缀 → false（即便不在目录中）', () => {
      expect(isGateable('b_hosted_new_metric')).toBe(false);
    });

    it('包含 _hosted_ → false（即便不在目录中）', () => {
      expect(isGateable('a_hosted_fallback')).toBe(false);
      expect(isGateable('c_hosted_aux')).toBe(false);
    });

    it('hosted 前缀优先于 findMetric 的 gateable 值', () => {
      // 构造一个假想的 hosted 指标名不在目录中，但 hosted 分支直接返回 false
      expect(isGateable('b_hosted_imaginary')).toBe(false);
    });
  });

  describe('不在目录中且非 hosted 的指标', () => {
    it('默认 ?? true → 返回 true', () => {
      // isGateable 的实现：findMetric(name)?.gateable ?? true
      // 找不到就是 true
      expect(isGateable('some_unknown_metric')).toBe(true);
      expect(isGateable('x_custom_score')).toBe(true);
    });
  });

  describe('边界输入', () => {
    it('空字符串 → 默认 true（不匹配 hosted 前缀）', () => {
      expect(isGateable('')).toBe(true);
    });

    it('仅下划线 → 默认 true', () => {
      expect(isGateable('_')).toBe(true);
    });
  });
});

// ============================================================
// METRIC_CATALOG 结构不变量
// ============================================================

describe('METRIC_CATALOG', () => {
  it('恰好 18 个指标（A 轴 5 + B 轴 8 + C 轴 5）', () => {
    expect(METRIC_CATALOG).toHaveLength(18);
  });

  it('指标名无重复', () => {
    const names = METRIC_CATALOG.map((m) => m.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    // 如果有重复，显式列出
    if (unique.size !== names.length) {
      const seen = new Set<string>();
      const dupes = names.filter((n) => {
        if (seen.has(n)) return true;
        seen.add(n);
        return false;
      });
      expect(dupes, `重复的指标名: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
    }
  });

  it('每个指标名非空', () => {
    for (const m of METRIC_CATALOG) {
      expect(m.name, `指标名不应为空`).toBeTruthy();
      expect(typeof m.name).toBe('string');
    }
  });

  it('每个指标的 aggregation 为 mean 或 sum', () => {
    for (const m of METRIC_CATALOG) {
      expect(['mean', 'sum']).toContain(m.aggregation);
    }
  });

  it('gateable 与 hosted 命名一致性检查', () => {
    // b_hosted_ 开头的指标应该 gateable: false
    for (const m of METRIC_CATALOG) {
      if (m.name.startsWith('b_hosted') || m.name.includes('_hosted_')) {
        expect(m.gateable, `hosted 前缀指标 "${m.name}" 的 gateable 应为 false`).toBe(false);
      }
    }
  });

  it('每个指标都有 axis / meaning 字段', () => {
    for (const m of METRIC_CATALOG) {
      expect(m.axis, `"${m.name}" 缺 axis`).toBeTruthy();
      expect(m.meaning, `"${m.name}" 缺 meaning`).toBeTruthy();
      expect(typeof m.higher_is_better).toBe('boolean');
    }
  });

  it('gateable=false 的指标恰好是预期的 4 项（精确枚举）', () => {
    const nonGateable = METRIC_CATALOG.filter((m) => !m.gateable)
      .map((m) => m.name)
      .sort();
    expect(nonGateable).toEqual([
      'b_avg_steps_to_success',
      'b_cost_tokens_per_pass',
      'b_hosted_attribution_share',
      'b_task_pass_rate',
    ]);
  });

  it('每个指标的 axis 取值必须为 A、B 或 C', () => {
    for (const m of METRIC_CATALOG) {
      expect(['A', 'B', 'C'], `"${m.name}" 的 axis "${m.axis}" 不在合法集合内`).toContain(m.axis);
    }
  });
});
