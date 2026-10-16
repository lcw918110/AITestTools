/**
 * 运行环境 API：模型/Agent 清单、添加、验证、房间（controller）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import { parseJsonObject, sanitizeRoomUpdate } from '../parse.ts';
import { safeUnder } from '../bank.ts';
import { writeJsonAtomicCas } from '../json-io.ts';
import { addEnvAgent, addEnvModel, loadEnvCatalog, verifyEnvEntry } from '../env-catalog.ts';

export async function envCatalog(): Promise<HttpResponse> {
  return { status: 200, body: loadEnvCatalog(PROJECT) };
}

export async function envAddModel(body: { id?: string }): Promise<HttpResponse> {
  const result = addEnvModel(PROJECT, body.id ?? '');
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 201, body: result };
}

export async function envAddAgent(body: { id?: string }): Promise<HttpResponse> {
  const result = addEnvAgent(PROJECT, body.id ?? '');
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 201, body: result };
}

export async function envVerify(body: { kind?: string; id?: string }): Promise<HttpResponse> {
  if (body.kind !== 'model' && body.kind !== 'agent') {
    return { status: 400, body: { error: 'kind 须为 model 或 agent' } };
  }
  const result = verifyEnvEntry(PROJECT, body.kind, (body.id ?? '').trim());
  if ('error' in result) {
    return { status: result.code, body: { error: result.error } };
  }
  return { status: 200, body: result };
}

export async function envRoomsList(): Promise<HttpResponse> {
  const roomsDir = join(PROJECT, 'rooms');
  const roomFiles: Array<{
    name: string;
    host: Record<string, unknown>;
    workspace?: unknown;
    network?: unknown;
  }> = [];
  if (existsSync(roomsDir)) {
    for (const f of readdirSync(roomsDir)) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      const name = f.replace(/\.json$/, '');
      const abs = safeUnder(roomsDir, f);
      if (!abs) continue;
      try {
        const text = readFileSync(abs, 'utf8');
        const parsed = parseJsonObject(text, `rooms/${f}`);
        if (!parsed.ok) continue;
        const doc = parsed.value;
        const host =
          typeof doc.host === 'object' && doc.host !== null && !Array.isArray(doc.host)
            ? (doc.host as Record<string, unknown>)
            : {};
        roomFiles.push({
          name,
          host,
          ...(doc.workspace !== undefined ? { workspace: doc.workspace } : {}),
          ...(doc.network !== undefined ? { network: doc.network } : {}),
        });
      } catch {
        continue;
      }
    }
  }
  return { status: 200, body: { rooms: roomFiles } };
}

export async function envRoomsUpdate(
  roomName: string,
  body: { host?: Record<string, unknown>; workspace?: unknown; network?: unknown },
): Promise<HttpResponse> {
  const roomsDir = join(PROJECT, 'rooms');
  const fileName = `${roomName}.json`;
  const abs = safeUnder(roomsDir, fileName);
  if (!abs || !existsSync(abs)) {
    return { status: 404, body: { error: 'room not found' } };
  }
  try {
    const readMtime = statSync(abs).mtimeMs;
    const existingText = readFileSync(abs, 'utf8');
    const existing = JSON.parse(existingText) as Record<string, unknown>;
    const update = sanitizeRoomUpdate(body);
    for (const w of update.warnings) {
      console.warn(`PUT /api/env/rooms/${roomName}: ${w}`);
    }
    if (update.host !== undefined) {
      existing.host = { ...((existing.host as Record<string, unknown>) ?? {}), ...update.host };
    }
    if (update.workspace !== undefined) {
      existing.workspace = update.workspace;
    }
    if (update.network !== undefined) {
      existing.network = update.network;
    }
    const wrote = writeJsonAtomicCas(abs, existing, readMtime);
    if (!wrote) {
      return { status: 409, body: { error: '房间配置已被并发修改，请重新读取后重试' } };
    }
    const resultHost =
      typeof existing.host === 'object' && existing.host !== null && !Array.isArray(existing.host)
        ? (existing.host as Record<string, unknown>)
        : {};
    return {
      status: 200,
      body: {
        name: roomName,
        host: resultHost,
        ...(existing.workspace !== undefined ? { workspace: existing.workspace } : {}),
        ...(existing.network !== undefined ? { network: existing.network } : {}),
      },
    };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}
