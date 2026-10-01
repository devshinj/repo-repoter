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

/** ISO 8601 타임스탬프를 KST 날짜 문자열 (YYYY-MM-DD)로 변환. 파싱 불가 시 앞 10자리 폴백 */
export function isoToKstDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return toKstDateString(d);
}

/** KST 날짜(YYYY-MM-DD)의 자정(+offset일)을 UTC ISO 문자열로 반환 — API since/until 파라미터용 */
export function kstDayStartIso(kstDate: string, offsetDays: number = 0): string {
  const d = new Date(`${kstDate}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
}

/** node-cron schedule 옵션에 전달할 timezone 설정 */
export const kstCronOptions = { timezone: kstTimeZone } as const;
