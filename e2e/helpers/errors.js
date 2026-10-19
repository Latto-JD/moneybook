import { expect } from '@playwright/test';

/**
 * 에러 응답 형식 검사 (plan 4.3): { error: { code, message } }
 * 스택/SQL 노출 여부도 함께 점검한다.
 */
export async function expectError(res, status, code) {
  expect(res.status(), `status (body: ${await res.text().catch(() => '')})`).toBe(status);
  const ct = res.headers()['content-type'] || '';
  expect(ct).toContain('application/json');
  const body = await res.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error.code).toBe('string');
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
  if (code) expect(body.error.code).toBe(code);
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/\bat \S+ \(|node_modules|SELECT |INSERT |UPDATE |syntax error|pg_/i);
  return body.error;
}
