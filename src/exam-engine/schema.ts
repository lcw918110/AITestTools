import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { Issue } from './types.ts';

/** 资产协议版本（ADR-0006）。 */
export const ASSET_PROTOCOL_VERSION = 'papers-v1';

const SCHEMA_FILES = {
  item: 'item.schema.json',
  paperset: 'paperset.schema.json',
  room: 'room.schema.json',
  exam: 'exam.schema.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

function loadSchema(file: string): object {
  const url = new URL(`../../schemas/${file}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as object;
}

let validators: Record<SchemaName, ValidateFunction> | undefined;

function getValidators(): Record<SchemaName, ValidateFunction> {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats.default(ajv);
  validators = Object.fromEntries(
    Object.entries(SCHEMA_FILES).map(([name, file]) => [name, ajv.compile(loadSchema(file))]),
  ) as Record<SchemaName, ValidateFunction>;
  return validators;
}

function formatAjvError(err: ErrorObject): string {
  const where = err.instancePath === '' ? '根对象' : err.instancePath;
  if (err.keyword === 'additionalProperties') {
    return `${where}: 出现协议未定义的字段 "${String(err.params.additionalProperty)}"`;
  }
  if (err.keyword === 'required') {
    return `${where}: 缺少必填字段 "${String(err.params.missingProperty)}"`;
  }
  if (err.keyword === 'enum' || err.keyword === 'const') {
    if (err.keyword === 'const') {
      return `${where}: 取值必须是 ${JSON.stringify(err.params.allowedValue)}`;
    }
    const allowed = (err.params.allowedValues as unknown[]).join(' | ');
    return `${where}: 取值必须是 ${allowed}`;
  }
  return `${where}: ${err.message ?? '不符合协议'}`;
}

export function validateAgainstSchema(name: SchemaName, doc: unknown, file: string): Issue[] {
  const validate = getValidators()[name];
  if (validate(doc)) return [];
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const err of validate.errors ?? []) {
    if (err.keyword === 'if' || err.keyword === 'allOf') continue;
    const message = formatAjvError(err);
    const key = `${err.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      level: 'error',
      code: `SCHEMA_${name.toUpperCase()}`,
      message,
      file,
      instancePath: err.instancePath,
    });
  }
  return issues;
}
