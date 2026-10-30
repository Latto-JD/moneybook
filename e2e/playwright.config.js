import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// 360px 모바일 / 768px 태블릿, 둘 다 chromium.
// devices 프리셋의 모바일 에뮬레이션 대신 뷰포트 폭을 정확히 360/768 로 지정한다(C32 검증).
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1, // IP/이메일 기준 시도 제한 테스트가 서로 간섭하지 않도록 직렬 실행
  retries: 0,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    reducedMotion: 'reduce', // 모션 도입 후에도 기존 e2e 는 움직임 없이 돈다(plan-motion 6장). 움직임 자체는 motion.spec.js 가 'no-preference' 로 확인
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, hasTouch: true },
    },
    {
      name: 'tablet-768',
      // API 테스트는 뷰포트와 무관하므로 mobile-360 에서만 실행하고, 768 은 UI 테스트만 실행
      testMatch: /(frontend|dashboard-ui|categories-ui|design|theme-name|followup-1|followup-2|followup-2b|followup-2c|improvements|motion|spring|category-history)\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
  ],
});
