// Vercel 서버리스 함수 단일 진입점. 모든 /api/* 요청은 vercel.json rewrites 로 여기에 도착한다.
// 실제 처리는 src/backend 의 라우터가 한다. (PGlite 는 이 경로에서 import 하지 않는다)
import handler from '../src/backend/app.js';

export default handler;
