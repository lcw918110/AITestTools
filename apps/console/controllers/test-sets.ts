/**
 * 测试集 API（controller）。
 */
import type { HttpResponse } from '../http.ts';
import { PROJECT } from '../config.ts';
import { createTestSet, listTestSets, testSetDetail } from '../test-sets.ts';

export interface TestSetCreateBody {
  name?: string;
  description?: string;
  id?: string;
}

export async function testSetsList(): Promise<HttpResponse> {
  return { status: 200, body: { testSets: listTestSets(PROJECT) } };
}

export async function testSetsCreate(body: TestSetCreateBody): Promise<HttpResponse> {
  const created = createTestSet(PROJECT, body);
  if ('error' in created) {
    return { status: created.code, body: { error: created.error } };
  }
  return { status: 201, body: created };
}

export async function testSetsGet(id: string): Promise<HttpResponse> {
  const detail = testSetDetail(PROJECT, id);
  if ('error' in detail) {
    return { status: detail.code, body: { error: detail.error } };
  }
  return { status: 200, body: detail };
}
