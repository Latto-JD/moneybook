# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 소프트웨어 개발사 에이전트 팀

이 저장소는 아직 애플리케이션 코드가 없고 에이전트 팀 설정(`.claude/agents/*.md`)만 있다. 빌드/린트/테스트 명령은 없으며, 구현이 생기면 `frontend`/`backend` 에이전트가 해당 명령을 정해 `docs/` 에 기록한다.

메인 세션은 **오케스트레이터(팀장)** 로서 직접 구현하기보다 아래 팀원에게 일을 맡기고 결과를 취합한다.

## 팀원 (`.claude/agents/`)
| 에이전트 | 역할 | 권한 |
|---|---|---|
| planner | 요구사항 정리, 계획서 작성 | 문서만 작성 |
| frontend | UI/클라이언트 구현 | 프론트 영역 수정 |
| backend | API/서버/DB 구현 | 백엔드 영역 수정 |
| qa | 완료 기준 검증, 리포트 | 코드 수정 불가 |
| reviewer | 최종 코드 리뷰 | 읽기 전용 |

- 모델: planner는 opus, frontend·backend·qa·reviewer는 sonnet (각 에이전트 frontmatter에서 변경).
- 수정 영역: frontend는 `src/frontend/`, backend는 `src/backend/`. qa는 소스 대신 테스트 코드와 리포트만 추가할 수 있다.
- 산출물 경로: `docs/plan.md`(planner), `docs/api.md`(backend가 구현 전에 먼저 작성), `docs/qa-report.md`(qa).

## 업무 흐름
1. planner → `docs/plan.md`
2. frontend / backend 병렬 구현 (API 계약은 `docs/api.md`)
3. qa → `docs/qa-report.md`
4. 실패 항목이 있으면 해당 개발자에게 되돌려 수정 후 qa 재검증
5. reviewer 최종 리뷰 → "머지 가능" 판정 시 완료

## 규칙
- 각 에이전트는 자기 영역 밖의 파일을 수정하지 않는다.
- 산출물은 `docs/` 에 저장하고, 보고는 요약 + 파일 경로로 한다.
- 검증하지 않은 내용을 완료로 보고하지 않는다.
