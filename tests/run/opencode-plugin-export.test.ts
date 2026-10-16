import { describe, expect, it } from 'vitest';
import { resolveOpenCodePluginExport } from '../../src/drivers/model-adapter/opencode-plugin-export.ts';
import { partitionHostedProtocolProbes } from '../../src/attribution/ndjson-probes.ts';

describe('resolveOpenCodePluginExport', () => {
  it('旧工厂 plugin(ctx)', () => {
    const factory = () => ({ event: () => undefined });
    const r = resolveOpenCodePluginExport({ plugin: factory });
    expect(r?.factory).toBe(factory);
    expect(r?.id).toBe('plugin');
  });

  it('新包 { id, server }', () => {
    const server = () => ({ event: () => undefined });
    const r = resolveOpenCodePluginExport({
      default: { id: 'wanxiangshu-next', server },
    });
    expect(r?.factory).toBe(server);
    expect(r?.id).toBe('wanxiangshu-next');
  });

  it('无法识别则 null', () => {
    expect(resolveOpenCodePluginExport({ default: { id: 'x' } })).toBeNull();
  });
});

describe('partitionHostedProtocolProbes', () => {
  it('跳过旧 WanEvent 探针，保留 EventStore Fact 名', () => {
    expect(
      partitionHostedProtocolProbes(['assistant_completed', 'loop_activated', 'RuntimeStarted']),
    ).toEqual({
      active: ['RuntimeStarted'],
      skippedStale: ['assistant_completed', 'loop_activated'],
    });
  });
});
