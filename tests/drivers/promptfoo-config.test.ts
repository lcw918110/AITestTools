import { describe, expect, it } from 'vitest';
import { buildPromptfooConfig } from '../../src/drivers/model-adapter/promptfoo.ts';
import type { LiveProvider } from '../../src/drivers/model-adapter/promptfoo.ts';

/**
 * 验证 promptfoo 配置生成对用户输入中的 YAML 特殊字符是安全的。
 * 实现用 JS 对象 + JSON.stringify 序列化（JSON 是 YAML 1.2 子集），
 * 因此能被 JSON.parse 成功 round-trip 即证明是合法 YAML，且特殊字符不被破坏。
 */
describe('buildPromptfooConfig（YAML 特殊字符安全）', () => {
  const providers: Array<LiveProvider & { model: string }> = [
    {
      model: 'deepseek-chat',
      apiKey: 'sk-secret:with#hash"and\'quote',
      baseUrl: 'https://api.deepseek.com',
      toolChoice: 'auto',
    },
  ];

  const nastyPrompt = [
    '## 标题: 包含冒号',
    '行内 # 井号 与 "双引号" 以及 \'单引号\'',
    '花括号 { todos: [1,2,3] } 与方括号 [a,b]',
    '反斜杠 \\ 与制表符\t以及美元大括号 ${not_interpolated}',
    '',
    '多行正文第一行',
    '多行正文第二行',
  ].join('\n');

  const cases = [
    { item_id: 'ITEM:1', repeat: 1, prompt: nastyPrompt },
    { item_id: 'ITEM#2', repeat: 2, prompt: nastyPrompt },
  ];

  it('配置可被 JSON round-trip 解析，特殊字符完整保留', () => {
    const config = buildPromptfooConfig(providers, cases);
    const serialized = JSON.stringify(config, null, 2);

    // JSON 是 YAML 1.2 子集：能 JSON.parse 成功即证明是合法 YAML 配置
    const parsed = JSON.parse(serialized) as {
      tests: Array<{ vars: { prompt: string; item_id: string; repeat: string } }>;
    };

    expect(parsed.tests).toHaveLength(2);
    expect(parsed.tests[0]!.vars.prompt).toBe(nastyPrompt);
    expect(parsed.tests[0]!.vars.item_id).toBe('ITEM:1');
    expect(parsed.tests[0]!.vars.repeat).toBe('1');
    expect(parsed.tests[1]!.vars.prompt).toBe(nastyPrompt);
    expect(parsed.tests[1]!.vars.item_id).toBe('ITEM#2');
    expect(parsed.tests[1]!.vars.repeat).toBe('2');
  });

  it('provider id 前缀与 apiKey 特殊字符不被破坏', () => {
    const config = buildPromptfooConfig(providers, cases);
    const parsed = JSON.parse(JSON.stringify(config)) as {
      providers: Array<{ id: string; config: { apiKey: string; tool_choice: string } }>;
    };

    expect(parsed.providers[0]!.id).toBe('openai:chat:deepseek-chat');
    expect(parsed.providers[0]!.config.apiKey).toBe('sk-secret:with#hash"and\'quote');
    expect(parsed.providers[0]!.config.tool_choice).toBe('auto');
  });

  it('配置结构与 promptfoo 契约保持一致', () => {
    const config = buildPromptfooConfig(providers, cases) as Record<string, unknown>;

    expect(config.description).toBe('agent-proctor B-direct live spike');
    expect(config.prompts).toEqual(['{{prompt}}']);

    const prov = (config.providers as Array<Record<string, unknown>>)[0]!;
    const provConfig = prov.config as Record<string, unknown>;
    expect(prov.id).toBe('openai:chat:deepseek-chat');
    expect(provConfig.temperature).toBe(0);
    expect(provConfig.max_tokens).toBe(512);
    expect(provConfig.tool_choice).toBe('auto');
    expect(provConfig.tools).toBeDefined();

    // tool 参数 schema 仍要求 todos + merge
    const tools = provConfig.tools as Array<Record<string, unknown>>;
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    const params = fn.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['todos', 'merge']);
  });
});
