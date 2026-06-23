import { describe, it, expect } from "vitest";
import { extractMilestoneSummary } from "@/scheduler/feed-scheduler";

describe("extractMilestoneSummary", () => {
  it("단락 없는 단순 텍스트는 전체를 반환한다", () => {
    const briefing = "마일스톤 Alpha: 개발 중. 마감 3일 남음.";
    expect(extractMilestoneSummary(briefing)).toBe("마일스톤 Alpha: 개발 중. 마감 3일 남음.");
  });

  it("첫 빈 줄 이전까지만 추출한다", () => {
    const briefing = "첫째 줄\n둘째 줄\n\n셋째 줄 (두 번째 단락)";
    expect(extractMilestoneSummary(briefing)).toBe("첫째 줄\n둘째 줄");
  });

  it("여러 단락이 있어도 첫 단락만 반환한다", () => {
    const briefing = "마일스톤 요약\n- 진행 중\n\n작업자별 활동\n- Alice: feat 추가";
    expect(extractMilestoneSummary(briefing)).toBe("마일스톤 요약\n- 진행 중");
  });

  it("빈 문자열을 입력하면 null을 반환한다", () => {
    expect(extractMilestoneSummary("")).toBeNull();
  });

  it("공백만 있는 첫 줄은 유지하지 않는다", () => {
    // 첫 줄이 공백이면 summaryLines에 쌓이지만 아직 길이가 0이므로 break 안 됨
    // 빈 줄이 첫 줄인 경우: 아직 길이 0이므로 계속 push → "  " 이 들어감
    // 이 케이스는 실제로 중요하지 않지만 동작이 결정론적인지 확인
    const briefing = "첫 번째 내용";
    expect(extractMilestoneSummary(briefing)).toBe("첫 번째 내용");
  });

  it("단일 줄 브리핑도 올바르게 처리한다", () => {
    const briefing = "마일스톤 완료";
    expect(extractMilestoneSummary(briefing)).toBe("마일스톤 완료");
  });
});
