// src/core/date-utils.ts
// KST(Asia/Seoul) 기준 날짜 유틸리티

const kstTimeZone = "Asia/Seoul";

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export function getKstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: kstTimeZone });
}

/** KST 기준 어제 날짜 (YYYY-MM-DD) */
export function getKstYesterday(): string {
  return getKstDateString(-1);
}

/** KST 기준 offset일 후 날짜 (YYYY-MM-DD). 음수면 과거 */
export function getKstDateString(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: kstTimeZone });
}

/** KST 기준 N일 전 날짜 (YYYY-MM-DD) */
export function getKstDaysAgo(days: number): string {
  return getKstDateString(-days);
}

/** 임의의 Date 객체를 KST 날짜 문자열 (YYYY-MM-DD)로 변환 */
export function toKstDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: kstTimeZone });
}

/** node-cron schedule 옵션에 전달할 timezone 설정 */
export const kstCronOptions = { timezone: kstTimeZone } as const;
