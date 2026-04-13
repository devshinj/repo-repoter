"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { GitCommit, TrendingUp, Flame } from "lucide-react";

interface ContributionHeatmapProps {
  data: Record<string, number>;
  months?: number;
}

const levelColors = [
  { light: "oklch(0.95 0.01 250)", dark: "oklch(0.22 0.01 250)" },
  { light: "oklch(0.85 0.10 155)", dark: "oklch(0.32 0.08 155)" },
  { light: "oklch(0.72 0.16 155)", dark: "oklch(0.45 0.12 155)" },
  { light: "oklch(0.60 0.18 155)", dark: "oklch(0.55 0.16 155)" },
  { light: "oklch(0.48 0.16 155)", dark: "oklch(0.72 0.18 155)" },
];

const dayLabels: [number, string][] = [[1, "월"], [3, "수"], [5, "금"]];

function getLevel(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setDark(el.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function calcStreak(data: Record<string, number>): number {
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (true) {
    const key = formatDate(d);
    if ((data[key] ?? 0) > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function calcBusiestDay(data: Record<string, number>): { date: string; count: number } | null {
  let max = 0;
  let maxDate = "";
  for (const [date, count] of Object.entries(data)) {
    if (count > max) { max = count; maxDate = date; }
  }
  return max > 0 ? { date: maxDate, count: max } : null;
}

export function ContributionHeatmap({ data, months = 6 }: ContributionHeatmapProps) {
  const isDark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number; dateStr: string; count: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { weeks, monthLabels, totalCommits, activeDays } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setHours(0, 0, 0, 0);

    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);

    type WeekCol = ({ dateStr: string; count: number } | null)[];
    const weeksArr: WeekCol[] = [];
    const monthLabelMap: { weekIndex: number; label: string }[] = [];

    let current = new Date(startDate);
    let lastSeenMonth = -1;
    let active = 0;

    while (current <= today) {
      const weekCol: WeekCol = [];
      for (let d = 0; d < 7; d++) {
        if (current > today) {
          weekCol.push(null);
          current = new Date(current);
          current.setDate(current.getDate() + 1);
        } else {
          const dateStr = formatDate(current);
          const count = data[dateStr] ?? 0;
          if (count > 0) active++;
          weekCol.push({ dateStr, count });

          const month = current.getMonth();
          if (month !== lastSeenMonth) {
            const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];
            monthLabelMap.push({
              weekIndex: weeksArr.length,
              label: monthNames[month],
            });
            lastSeenMonth = month;
          }

          current = new Date(current);
          current.setDate(current.getDate() + 1);
        }
      }
      weeksArr.push(weekCol);
    }

    const total = Object.values(data).reduce((sum, v) => sum + v, 0);
    return { weeks: weeksArr, monthLabels: monthLabelMap, totalCommits: total, activeDays: active };
  }, [data, months]);

  const streak = useMemo(() => calcStreak(data), [data]);
  const busiest = useMemo(() => calcBusiestDay(data), [data]);

  const labelWidth = 28;
  const monthLabelHeight = 18;
  const gap = 3;
  const availableWidth = containerWidth > 0 ? containerWidth - labelWidth : 600;
  const cellSize = Math.max(10, Math.min(14, Math.floor((availableWidth - gap * (weeks.length - 1)) / weeks.length)));
  const svgWidth = labelWidth + weeks.length * (cellSize + gap);
  const svgHeight = monthLabelHeight + 7 * (cellSize + gap);

  const colors = levelColors.map((c) => (isDark ? c.dark : c.light));

  const handleCellEnter = useCallback((cell: { dateStr: string; count: number }, x: number, y: number) => {
    setHoveredCell({ x, y, dateStr: cell.dateStr, count: cell.count });
  }, []);

  const handleCellLeave = useCallback(() => {
    setHoveredCell(null);
  }, []);

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-5 pb-4 px-5">
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <GitCommit className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none">{totalCommits.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">총 커밋</p>
            </div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none">{activeDays}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">활동일</p>
            </div>
          </div>
          {streak > 0 && (
            <>
              <div className="w-px h-8 bg-border" />
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-500/10">
                  <Flame className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-lg font-bold leading-none">{streak}일</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">연속 커밋</p>
                </div>
              </div>
            </>
          )}
          {busiest && (
            <div className="ml-auto text-right hidden md:block">
              <p className="text-[11px] text-muted-foreground">최다 커밋일</p>
              <p className="text-xs font-medium">{busiest.date} · {busiest.count}커밋</p>
            </div>
          )}
        </div>

        {/* SVG Heatmap */}
        <div className="relative">
          <div ref={containerRef} className="w-full overflow-x-auto">
            {containerWidth > 0 && (
              <svg
                ref={svgRef}
                width={svgWidth}
                height={svgHeight}
                className="block"
                role="img"
                aria-label="커밋 히트맵"
                onMouseLeave={handleCellLeave}
              >
                {/* Month labels */}
                {monthLabels.map((m, idx) => (
                  <text
                    key={idx}
                    x={labelWidth + m.weekIndex * (cellSize + gap)}
                    y={12}
                    className="fill-muted-foreground"
                    fontSize={10}
                    fontWeight={500}
                    fontFamily="system-ui, sans-serif"
                  >
                    {m.label}
                  </text>
                ))}

                {/* Day labels */}
                {dayLabels.map(([dayIdx, label]) => (
                  <text
                    key={dayIdx}
                    x={labelWidth - 5}
                    y={monthLabelHeight + dayIdx * (cellSize + gap) + cellSize - 2}
                    className="fill-muted-foreground/70"
                    fontSize={9}
                    fontFamily="system-ui, sans-serif"
                    textAnchor="end"
                  >
                    {label}
                  </text>
                ))}

                {/* Cells */}
                {weeks.map((week, weekIdx) =>
                  week.map((cell, dayIdx) => {
                    if (!cell) return null;
                    const level = getLevel(cell.count);
                    const x = labelWidth + weekIdx * (cellSize + gap);
                    const y = monthLabelHeight + dayIdx * (cellSize + gap);
                    const isHovered = hoveredCell?.dateStr === cell.dateStr;
                    return (
                      <rect
                        key={`${weekIdx}-${dayIdx}`}
                        x={x}
                        y={y}
                        width={cellSize}
                        height={cellSize}
                        rx={2.5}
                        ry={2.5}
                        fill={colors[level]}
                        stroke={isHovered ? (isDark ? "oklch(0.85 0 0)" : "oklch(0.35 0 0)") : "none"}
                        strokeWidth={isHovered ? 1.5 : 0}
                        className="outline-none transition-opacity duration-75"
                        style={{ cursor: cell.count > 0 ? "pointer" : "default" }}
                        onMouseEnter={() => handleCellEnter(cell, x, y)}
                      />
                    );
                  })
                )}
              </svg>
            )}
          </div>

          {/* Tooltip — overflow 컨테이너 바깥에 배치하여 잘리지 않도록 함 */}
          {hoveredCell && (
            <div
              className="absolute z-50 pointer-events-none px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs shadow-md border border-border whitespace-nowrap"
              style={{
                left: hoveredCell.x + cellSize / 2,
                top: hoveredCell.y - 6,
                transform: "translate(-50%, -100%)",
              }}
            >
              <span className="font-medium">{hoveredCell.count}개 커밋</span>
              <span className="text-muted-foreground ml-1.5">{hoveredCell.dateStr}</span>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-3">
          <a
            href="/task-calendar"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            태스크 캘린더에서 상세 보기
          </a>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">적음</span>
            {colors.map((color, idx) => (
              <div
                key={idx}
                className="rounded-[3px]"
                style={{ width: 10, height: 10, backgroundColor: color }}
              />
            ))}
            <span className="text-[10px] text-muted-foreground ml-1">많음</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
