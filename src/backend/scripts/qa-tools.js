// QA 보조 CLI (개발 서버를 멈춘 상태에서 같은 PGLITE_DIR 에 적용).
// 사용: npm run qa:tools -- <명령> [--email=a@ex.com] [--minutes=16]
// 서버가 켜져 있는 동안에는 PGlite 데이터 디렉터리를 두 프로세스가 동시에 열면 안 되므로
// QA_TOOLS=true 로 띄운 개발 서버의 /__qa/<명령> 엔드포인트를 쓴다 (README 참고).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../db/index.js';
import { assertQaAllowed, runQaOp, QA_OPS } from './qa-ops.js';

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const args = {};
  for (const a of rest) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  try {
    assertQaAllowed(process.env);
    if (!name) throw new Error(`명령을 지정하세요: ${Object.keys(QA_OPS).join(', ')}`);
  } catch (e) {
    console.error(`qa-tools: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  let db;
  try {
    db = await createDb(process.env);
    console.log(JSON.stringify(await runQaOp(db, name, args)));
  } catch (e) {
    console.error(`qa-tools 실패: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
