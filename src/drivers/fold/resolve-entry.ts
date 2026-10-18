import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { CaseRevision, EnvironmentProfile, FoldEntrySpec } from '../../domain/types.ts';

export interface ResolvedFoldEntry {
  logicalName: string;
  spec: FoldEntrySpec;
  moduleUrl: string;
  normalize: 'json_clone' | 'none';
}

export class FoldResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoldResolveError';
  }
}

export function resolveFoldEntry(opts: {
  environment: EnvironmentProfile;
  execution_profile: NonNullable<CaseRevision['execution_profile']>;
  projectRoot: string;
  sutRoot?: string;
}): ResolvedFoldEntry {
  const name = opts.execution_profile.fold_entry;
  if (name === undefined) throw new FoldResolveError('execution_profile.fold_entry 缺失');
  const spec = opts.environment.recipe.fold_entries?.[name];
  if (spec === undefined) {
    throw new FoldResolveError(
      `fold_entry "${name}" 不在环境 ${opts.environment.environment_profile_id} 的 fold_entries 中`,
    );
  }
  if (
    opts.execution_profile.event_schema !== undefined &&
    opts.execution_profile.event_schema !== spec.event_schema
  ) {
    throw new FoldResolveError(
      `event_schema 不一致：试题 ${opts.execution_profile.event_schema} vs 入口 ${spec.event_schema}`,
    );
  }
  const root =
    (spec.resolve_root ?? 'sut') === 'project'
      ? opts.projectRoot
      : (opts.sutRoot ?? opts.projectRoot);
  const abs = resolve(root, spec.module);
  return {
    logicalName: name,
    spec,
    moduleUrl: pathToFileURL(abs).href,
    normalize: spec.normalize ?? 'json_clone',
  };
}

export function normalizeFoldResult(value: unknown, mode: 'json_clone' | 'none'): unknown {
  if (mode === 'none') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (e) {
    throw new FoldResolveError(`json_clone 失败：${(e as Error).message}`);
  }
}
