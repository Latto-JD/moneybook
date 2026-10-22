import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
const rule = (source) => config.headers.find((h) => h.source === source);
const cache = (source) => rule(source)?.headers.find((h) => h.key === 'Cache-Control')?.value;

test('vercel.json: /fonts/* 는 1년 immutable 캐시', () => {
  assert.equal(cache('/fonts/(.*)'), 'public, max-age=31536000, immutable');
});

test('vercel.json: / 와 /index.html 은 계속 no-store, 전체 규칙에 Cache-Control 없음', () => {
  assert.equal(cache('/'), 'no-store');
  assert.equal(cache('/index.html'), 'no-store');
  assert.equal(cache('/(.*)'), undefined);
});

test('vercel.json: 보안 헤더 유지', () => {
  const keys = rule('/(.*)').headers.map((h) => h.key);
  for (const k of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']) assert.ok(keys.includes(k), k);
});
