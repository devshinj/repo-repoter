import { describe, it, expect } from "vitest";
import { isoToKstDate, kstDayStartIso } from "@/core/date-utils";

describe("isoToKstDate", () => {
  it("UTC 타임스탬프를 KST 날짜로 변환한다 (KST 00~09시 커밋은 다음 날)", () => {
    expect(isoToKstDate("2026-09-14T16:30:00Z")).toBe("2026-09-15");
  });

  it("KST 오프셋 타임스탬프는 원래 날짜를 유지한다", () => {
    expect(isoToKstDate("2026-09-15T01:30:00+09:00")).toBe("2026-09-15");
  });

  it("KST 오후 시간대는 날짜가 바뀌지 않는다", () => {
    expect(isoToKstDate("2026-09-15T05:00:00Z")).toBe("2026-09-15");
  });

  it("파싱 불가한 값은 앞 10자리로 폴백한다", () => {
    expect(isoToKstDate("2026-09-15 garbage")).toBe("2026-09-15");
  });
});

describe("kstDayStartIso", () => {
  it("KST 자정을 ISO 문자열로 반환한다", () => {
    expect(kstDayStartIso("2026-09-15")).toBe("2026-09-14T15:00:00.000Z");
  });

  it("offset 일수를 더한다", () => {
    expect(kstDayStartIso("2026-09-15", -1)).toBe("2026-09-13T15:00:00.000Z");
    expect(kstDayStartIso("2026-09-30", 2)).toBe("2026-10-01T15:00:00.000Z");
  });
});
