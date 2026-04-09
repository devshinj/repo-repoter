"use client";

import { useMemo } from "react";

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

export function formatMonth(year: number, month: number) {
  return `${year}년 ${month + 1}월`;
}

function getIntensityClass(count: number, maxCount: number): string {
  if (count === 0) return "bg-muted";
  const ratio = count / maxCount;
  if (ratio <= 0.25) return "bg-emerald-200 dark:bg-emerald-900";
  if (ratio <= 0.5) return "bg-emerald-400 dark:bg-emerald-700";
  if (ratio <= 0.75) return "bg-emerald-500 dark:bg-emerald-600";
  return "bg-emerald-700 dark:bg-emerald-400";
}

function getIntensityText(count: number, maxCount: number): string {
  if (count === 0) return "text-muted-foreground";
  const ratio = count / maxCount;
  if (ratio <= 0.25) return "text-emerald-800 dark:text-emerald-200";
  if (ratio <= 0.5) return "text-white dark:text-emerald-100";
  return "text-white dark:text-emerald-50";
}

const weekDays = ["일", "월", "화", "수", "목", "금", "토"];

interface CalendarGridProps {
  year: number;
  month: number;
  commitCounts: Record<string, number>;
  maxCount: number;
  selectedDate: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  onSelectDate: (date: string) => void;
}

function isInRange(dateStr: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return dateStr >= start && dateStr <= end;
}

export function CalendarGrid({
  year, month, commitCounts, maxCount, selectedDate,
  rangeStart, rangeEnd, onSelectDate,
}: CalendarGridProps) {
  const today = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }, []);

  const { firstDay, daysInMonth } = getMonthDays(year, month);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{formatMonth(year, month)}</h3>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((d) => (
          <div key={d} className="text-[10px] text-center text-muted-foreground font-medium py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;

          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = commitCounts[dateStr] || 0;
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate && !rangeStart;
          const inRange = isInRange(dateStr, rangeStart, rangeEnd);
          const isRangeEdge = dateStr === rangeStart || dateStr === rangeEnd;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`
                relative aspect-square rounded-md text-xs flex flex-col items-center justify-center transition-all
                ${getIntensityClass(count, maxCount)}
                ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""}
                ${isRangeEdge ? "ring-2 ring-primary ring-offset-1" : ""}
                ${inRange && !isRangeEdge ? "ring-1 ring-primary/40" : ""}
                ${isToday ? "font-bold" : ""}
                hover:ring-2 hover:ring-primary/50
              `}
            >
              <span className={`leading-none ${count > 0 ? getIntensityText(count, maxCount) : "text-muted-foreground"}`}>
                {day}
              </span>
              {count > 0 && (
                <span className={`text-[9px] leading-none mt-0.5 ${getIntensityText(count, maxCount)}`}>
                  {count}
                </span>
              )}
              {isToday && (
                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
