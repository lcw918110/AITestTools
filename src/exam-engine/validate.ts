import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { findMetric, isGateable } from '../metrics/catalog.ts';
import { loadItems, loadPapersets, loadRooms } from './loader.ts';
import { checkProtocolCompatibility } from './project.ts';
import type { ExamProject } from './project.ts';
import { validateAgainstSchema } from './schema.ts';
import { semanticDigest } from './digest.ts';
import type { ItemDoc, Issue, LoadedAsset, PapersetDoc, RoomDoc } from './types.ts';

export interface ItemReport {
  file: string;
  relPath: string;
  id?: string;
  rev?: number;
  digest?: string;
  issues: Issue[];
}

/** @deprecated */
export type CaseReport = ItemReport;

export interface ValidationReport {
  projectName?: string;
  items: ItemReport[];
  /** @deprecated 使用 items */
  cases: ItemReport[];
  projectIssues: Issue[];
  errorCount: number;
  warningCount: number;
}

function err(code: string, message: string, file: string, instancePath?: string): Issue {
  return instancePath === undefined
    ? { level: 'error', code, message, file }
    : { level: 'error', code, message, file, instancePath };
}

function warn(code: string, message: string, file: string): Issue {
  return { level: 'warning', code, message, file };
}

export function validateItem(asset: LoadedAsset<ItemDoc>, materialsRoot?: string): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('item', asset.doc, file);
  if (issues.length > 0) return issues;

  const doc = asset.doc;

  if (materialsRoot !== undefined && !existsSync(resolve(materialsRoot, doc.stimulus.ref))) {
    issues.push(
      err(
        'STIMULUS_REF_MISSING',
        `stimulus.ref 指向的考材不存在：${doc.stimulus.ref}`,
        file,
        '/stimulus/ref',
      ),
    );
  }

  for (const name of [...doc.metrics.primary, ...(doc.metrics.secondary ?? [])]) {
    if (!findMetric(name)) {
      issues.push(
        warn(
          'METRIC_UNKNOWN',
          `指标 "${name}" 不在 PRD 附录 C 目录中；若为新增原子指标请先登记到 metrics/catalog`,
          file,
        ),
      );
    }
  }

  if (doc.rev > 1 && doc.change_log === undefined) {
    issues.push(warn('REV_WITHOUT_CHANGELOG', `rev=${doc.rev} 但缺少 change_log 说明`, file));
  }

  return issues;
}

/** @deprecated */
export const validateCase = validateItem;

function validateRoomAsset(asset: LoadedAsset<RoomDoc>): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('room', asset.doc, file);
  if (issues.length > 0) return issues;

  for (const secret of asset.doc.secrets ?? []) {
    if (secret !== 'env-only') {
      issues.push(
        err('ROOM_SECRET_INLINE', `secrets 只允许 env-only，发现 "${secret}"`, file, '/secrets'),
      );
    }
  }
  return issues;
}

function validatePapersetAsset(
  asset: LoadedAsset<PapersetDoc>,
  itemIndex: Map<string, ItemDoc>,
  roomIndex: Map<string, RoomDoc>,
  opts: { projectRoot?: string; checkFixtures?: boolean } = {},
): Issue[] {
  const file = asset.relPath;
  const issues = validateAgainstSchema('paperset', asset.doc, file);
  if (issues.length > 0) return issues;

  const paperset = asset.doc;
  const room = roomIndex.get(paperset.room);
  if (!room) {
    issues.push(err('PAPERSET_ROOM_MISSING', `引用了不存在的考场 "${paperset.room}"`, file));
  }

  for (const itemId of paperset.items) {
    const doc = itemIndex.get(itemId);
    if (!doc) {
      issues.push(err('PAPERSET_ITEM_MISSING', `引用了不存在的试题 "${itemId}"`, file));
      continue;
    }
    if (doc.axis !== paperset.axis) {
      issues.push(
        warn(
          'PAPERSET_AXIS_MISMATCH',
          `试题 ${itemId} 的 axis=${doc.axis} 与 paperset 声明不一致`,
          file,
        ),
      );
    }
    if (doc.status === 'deprecated') {
      issues.push(warn('PAPERSET_DEPRECATED_ITEM', `包含已废弃试题 ${itemId}`, file));
    }
    if (doc.execution.requires_network && room && !room.network) {
      issues.push(
        err(
          'PAPERSET_NETWORK_CONFLICT',
          `试题 ${itemId} 需要网络，但考场 "${room.name}" 声明 network=false`,
          file,
        ),
      );
    }

    if (doc.axis === 'A' && 'layer' in doc.freeze && doc.freeze.layer === 'L1' && room) {
      if (room.kind !== 'fold') {
        issues.push(
          err(
            'L1_ROOM_NOT_FOLD',
            `L1 试题 ${itemId} 绑定考场 "${room.name}" 的 kind=${room.kind}，须为 fold`,
            file,
          ),
        );
      } else {
        const entryName = doc.freeze.fold_entry;
        const entry = entryName !== undefined ? room.fold_entries?.[entryName] : undefined;
        if (entryName === undefined || entry === undefined) {
          issues.push(
            err(
              'L1_FOLD_ENTRY_MISSING',
              `L1 试题 ${itemId} 的 fold_entry "${String(entryName)}" 不在考场 "${room.name}" 的 fold_entries 中`,
              file,
            ),
          );
        } else if (
          doc.freeze.event_schema !== undefined &&
          doc.freeze.event_schema !== entry.event_schema
        ) {
          issues.push(
            err(
              'L1_EVENT_SCHEMA_MISMATCH',
              `试题 ${itemId} 的 event_schema=${doc.freeze.event_schema} 与入口声明 ${entry.event_schema} 不一致`,
              file,
            ),
          );
        }
      }
    }

    if (
      opts.checkFixtures === true &&
      opts.projectRoot !== undefined &&
      doc.axis === 'A' &&
      'layer' in doc.freeze &&
      doc.freeze.layer === 'L2' &&
      typeof doc.freeze.script === 'string' &&
      !existsSync(resolve(opts.projectRoot, doc.freeze.script))
    ) {
      issues.push(
        err('L2_SCRIPT_MISSING', `L2 试题 ${itemId} 的 script 不存在：${doc.freeze.script}`, file),
      );
    }

    if (doc.axis === 'A' && 'layer' in doc.freeze && doc.freeze.layer === 'L3') {
      if (typeof doc.freeze.cassette !== 'string' || doc.freeze.cassette.length === 0) {
        issues.push(err('L3_CASSETTE_MISSING', `L3 试题 ${itemId} 必须声明 freeze.cassette`, file));
      } else if (
        opts.checkFixtures === true &&
        opts.projectRoot !== undefined &&
        !existsSync(resolve(opts.projectRoot, doc.freeze.cassette))
      ) {
        issues.push(
          err(
            'L3_CASSETTE_MISSING',
            `L3 试题 ${itemId} 的 cassette 不存在：${doc.freeze.cassette}`,
            file,
          ),
        );
      }
    }
  }

  const gateNames = Object.keys(paperset.gates ?? {});
  if (room?.kind === 'hosted' && gateNames.length > 0) {
    issues.push(
      err(
        'GATE_ON_HOSTED_ROOM',
        'hosted 通道结果只作对照，不得配置门禁（PRD §5.2）',
        file,
        '/gates',
      ),
    );
  }
  for (const name of gateNames) {
    if (name.includes('hosted') || name.startsWith('b_hosted_')) {
      issues.push(
        err('GATE_NOT_ALLOWED', `指标 "${name}" 为 hosted 对照指标，禁止作为门禁`, file, '/gates'),
      );
      continue;
    }
    if (!isGateable(name)) {
      issues.push(
        err(
          'GATE_NOT_ALLOWED',
          `指标 "${name}" 不允许作为门禁（PRD §5.2 / 附录 C）`,
          file,
          '/gates',
        ),
      );
    } else if (!findMetric(name)) {
      issues.push(warn('GATE_UNKNOWN_METRIC', `门禁指标 "${name}" 不在指标目录中`, file));
    }
  }

  return issues;
}

export function validateProject(
  project: ExamProject,
  options: { checkFixtures?: boolean } = {},
): ValidationReport {
  const projectIssues: Issue[] = [
    ...checkProtocolCompatibility(project.manifest, project.manifestPath),
  ];

  const itemAssets = loadItems(project.dirs.items, project.root);
  const materialsRoot = options.checkFixtures === true ? project.root : undefined;

  const items: ItemReport[] = [];
  const itemIndex = new Map<string, ItemDoc>();
  const firstSeen = new Map<string, string>();

  for (const asset of itemAssets) {
    const issues = validateItem(asset, materialsRoot);
    const id = typeof asset.doc.id === 'string' ? asset.doc.id : undefined;
    if (id !== undefined) {
      const previous = firstSeen.get(id);
      if (previous !== undefined) {
        issues.push(err('ITEM_ID_DUPLICATE', `试题号 ${id} 与 ${previous} 重复`, asset.relPath));
      } else {
        firstSeen.set(id, asset.relPath);
        if (issues.every((i) => i.level !== 'error')) itemIndex.set(id, asset.doc);
      }
    }
    const report: ItemReport = { file: asset.path, relPath: asset.relPath, issues };
    if (id !== undefined) report.id = id;
    if (typeof asset.doc.rev === 'number') report.rev = asset.doc.rev;
    if (issues.every((i) => i.level !== 'error')) report.digest = semanticDigest(asset.doc);
    items.push(report);
  }

  const roomAssets = loadRooms(project.dirs.rooms, project.root);
  const roomIndex = new Map<string, RoomDoc>();
  for (const asset of roomAssets) {
    const issues = validateRoomAsset(asset);
    projectIssues.push(...issues);
    if (issues.every((i) => i.level !== 'error')) roomIndex.set(asset.doc.name, asset.doc);
  }

  for (const asset of loadPapersets(project.dirs.papersets, project.root)) {
    projectIssues.push(
      ...validatePapersetAsset(asset, itemIndex, roomIndex, {
        projectRoot: project.root,
        checkFixtures: options.checkFixtures === true,
      }),
    );
  }

  const all = [...items.flatMap((c) => c.issues), ...projectIssues];
  const report: ValidationReport = {
    items,
    cases: items,
    projectIssues,
    errorCount: all.filter((i) => i.level === 'error').length,
    warningCount: all.filter((i) => i.level === 'warning').length,
  };
  if (project.manifest.name !== undefined) report.projectName = project.manifest.name;
  return report;
}
