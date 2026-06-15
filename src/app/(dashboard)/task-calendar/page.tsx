"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { api } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, GitCommit, CalendarDays } from "lucide-react";
import { CalendarGrid, formatMonth } from "./components/calendar-grid";
import { RepoFilter } from "./components/repo-filter";
import { PeriodPresets, type PresetKey } from "./components/period-presets";
import { DateDetailPanel } from "./components/date-detail-panel";
import { RangeDetailPanel } from "./components/range-detail-panel";

type ViewMode = "1month" | "3months";

interface RepoInfo {
  id: number;
  owner: string;
  repo: string;
}

export default function TaskCalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("1month");
  const [baseYear, setBaseYear] = useState(new Date().getFullYear());
  const [baseMonth, setBaseMonth] = useState(new Date().getMonth());
  const [commitCounts, setCommitCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // 저장소 필터
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<number>>(new Set());

  // 날짜/기간 선택
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });
  const [activePreset, setActivePreset] = useState<PresetKey>(null);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [customFirstClick, setCustomFirstClick] = useState<string | null>(null);

  // 저장소 목록 로드
  useEffect(() => {
    fetch(api("/repos"))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const repoList = data.map((r: any) => ({ id: r.id, owner: r.owner, repo: r.repo }));
          setRepos(repoList);
          setSelectedRepoIds(new Set(repoList.map((r: RepoInfo) => r.id)));
        }
      })
      .catch(() => {});
  }, []);

  // 표시할 월 목록
  const months = useMemo(() => {
    const count = viewMode === "3months" ? 3 : 1;
    const result: { year: number; month: number }[] = [];
    for (let i = 0; i < count; i++) {
      let m = baseMonth + i;
      let y = baseYear;
      if (m > 11) { m -= 12; y += 1; }
      result.push({ year: y, month: m });
    }
    return result;
  }, [baseYear, baseMonth, viewMode]);

  // 데이터 범위 계산
  const calendarDateRange = useMemo(() => {
    const first = months[0];
    const last = months[months.length - 1];
    const since = `${first.year}-${String(first.month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(last.year, last.month + 1, 0).getDate();
    const until = `${last.year}-${String(last.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { since, until };
  }, [months]);

  // repoIds 쿼리 파라미터
  const repoIdsParam = useMemo(() => {
    if (selectedRepoIds.size === 0 || selectedRepoIds.size === repos.length) return "";
    return Array.from(selectedRepoIds).join(",");
  }, [selectedRepoIds, repos]);

  // 커밋 카운트 로드
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ since: calendarDateRange.since, until: calendarDateRange.until });
    if (repoIdsParam) params.set("repoIds", repoIdsParam);
    fetch(api(`/repos/commit-calendar?${params}`))
      .then((r) => r.json())
      .then((data) => {
        if (typeof data === "object" && !data.error) setCommitCounts(data);
      })
      .finally(() => setLoading(false));
  }, [calendarDateRange, repoIdsParam]);

  const maxCount = useMemo(() => {
    const values = Object.values(commitCounts);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [commitCounts]);

  const totalCommits = useMemo(() => Object.values(commitCounts).reduce((sum, c) => sum + c, 0), [commitCounts]);
  const activeDays = useMemo(() => Object.values(commitCounts).filter((c) => c > 0).length, [commitCounts]);

  const navigateMonth = (delta: number) => {
    let m = baseMonth + delta;
    let y = baseYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setBaseYear(y);
    setBaseMonth(m);
  };

  const goToday = () => {
    setBaseYear(new Date().getFullYear());
    setBaseMonth(new Date().getMonth());
  };

  // 프리셋 변경 핸들러
  const handlePresetChange = useCallback((preset: PresetKey, range: { since: string; until: string } | null) => {
    setActivePreset(preset);
    setCustomFirstClick(null);
    if (range) {
      setRangeStart(range.since);
      setRangeEnd(range.until);
      setSelectedDate(null);
    } else {
      setRangeStart(null);
      setRangeEnd(null);
    }
  }, []);

  // 날짜 클릭 핸들러
  const handleDateSelect = useCallback((date: string) => {
    if (activePreset === "custom") {
      // 커스텀 모드: 첫 클릭 = 시작일, 두 번째 클릭 = 종료일
      if (!customFirstClick) {
        setCustomFirstClick(date);
        setRangeStart(date);
        setRangeEnd(null);
        setSelectedDate(null);
      } else {
        const start = customFirstClick < date ? customFirstClick : date;
        const end = customFirstClick < date ? date : customFirstClick;
        setRangeStart(start);
        setRangeEnd(end);
        setSelectedDate(null);
        setCustomFirstClick(null);
      }
    } else {
      // 일반 모드: 단일 날짜 선택, 프리셋 해제
      setActivePreset(null);
      setRangeStart(null);
      setRangeEnd(null);
      setCustomFirstClick(null);
      setSelectedDate(date);
    }
  }, [activePreset, customFirstClick]);

  const isRangeMode = rangeStart !== null && rangeEnd !== null;
  const selectedCount = selectedDate ? (commitCounts[selectedDate] || 0) : 0;

  return (
    <div>
      <Header
        title="태스크 캘린더"
        description="연동된 저장소의 커밋 활동을 캘린더로 확인합니다"
      />

      {/* 컨트롤 바 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigateMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>오늘</Button>
          <Button variant="outline" size="sm" onClick={() => navigateMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2">
            {formatMonth(baseYear, baseMonth)}
            {viewMode === "3months" && ` — ${formatMonth(months[2].year, months[2].month)}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 mr-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <GitCommit className="h-3.5 w-3.5" />{totalCommits} 커밋
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />{activeDays}일 활동
            </span>
          </div>
          <div className="flex rounded-md border">
            <Button
              variant={viewMode === "1month" ? "default" : "ghost"}
              size="sm" className="rounded-r-none text-xs h-8"
              onClick={() => setViewMode("1month")}
            >1개월</Button>
            <Button
              variant={viewMode === "3months" ? "default" : "ghost"}
              size="sm" className="rounded-l-none text-xs h-8"
              onClick={() => setViewMode("3months")}
            >3개월</Button>
          </div>
        </div>
      </div>

      {/* 필터 바: 저장소 필터 + 기간 프리셋 */}
      <div className="flex items-center justify-between mb-6">
        <RepoFilter repos={repos} selectedIds={selectedRepoIds} onSelectionChange={setSelectedRepoIds} />
        <PeriodPresets activePreset={activePreset} onPresetChange={handlePresetChange} />
      </div>

      {/* 커스텀 기간 안내 */}
      {activePreset === "custom" && !rangeEnd && (
        <div className="mb-4 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          {customFirstClick
            ? `시작일: ${customFirstClick} — 종료일을 클릭하세요`
            : "캘린더에서 시작일을 클릭하세요"}
        </div>
      )}

      {/* 캘린더 그리드 */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-lg">
            <span className="text-sm text-muted-foreground animate-pulse">커밋 데이터 로딩 중...</span>
          </div>
        )}

        <div className={`grid gap-6 ${viewMode === "3months" ? "grid-cols-3" : "grid-cols-1 max-w-sm"}`}>
          {months.map(({ year, month }) => (
            <CalendarGrid
              key={`${year}-${month}`}
              year={year}
              month={month}
              commitCounts={commitCounts}
              maxCount={maxCount}
              selectedDate={selectedDate}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onSelectDate={handleDateSelect}
            />
          ))}
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-2 mt-6 text-xs text-muted-foreground">
          <span>적음</span>
          <div className="flex gap-0.5">
            <div className="w-3 h-3 rounded-sm bg-muted" />
            <div className="w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-900" />
            <div className="w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-700" />
            <div className="w-3 h-3 rounded-sm bg-emerald-500 dark:bg-emerald-600" />
            <div className="w-3 h-3 rounded-sm bg-emerald-700 dark:bg-emerald-400" />
          </div>
          <span>많음</span>
        </div>

      </div>

      {/* 하단 패널: 단일 날짜 or 기간 — 캘린더 그리드 바깥, 전체 너비 사용 */}
      {isRangeMode ? (
        <RangeDetailPanel rangeStart={rangeStart} rangeEnd={rangeEnd} repoIds={repoIdsParam} />
      ) : selectedDate ? (
        <DateDetailPanel selectedDate={selectedDate} commitCount={selectedCount} repoIds={repoIdsParam} />
      ) : null}
    </div>
  );
}
