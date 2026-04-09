"use client";

import { Button } from "@/components/ui/button";

type PresetKey = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom" | null;

interface PeriodPresetsProps {
  activePreset: PresetKey;
  onPresetChange: (preset: PresetKey, range: { since: string; until: string } | null) => void;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPresetRange(preset: PresetKey): { since: string; until: string } | null {
  if (!preset || preset === "custom") return null;
  const today = new Date();

  switch (preset) {
    case "thisWeek": {
      const monday = getMonday(today);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return { since: formatDate(monday), until: formatDate(sunday) };
    }
    case "lastWeek": {
      const monday = getMonday(today);
      monday.setDate(monday.getDate() - 7);
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return { since: formatDate(monday), until: formatDate(sunday) };
    }
    case "thisMonth": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { since: formatDate(first), until: formatDate(last) };
    }
    case "lastMonth": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { since: formatDate(first), until: formatDate(last) };
    }
    default:
      return null;
  }
}

const presets: { key: PresetKey; label: string }[] = [
  { key: "thisWeek", label: "이번 주" },
  { key: "lastWeek", label: "지난 주" },
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난 달" },
  { key: "custom", label: "커스텀" },
];

export function PeriodPresets({ activePreset, onPresetChange }: PeriodPresetsProps) {
  function handleClick(key: PresetKey) {
    if (key === activePreset) {
      onPresetChange(null, null);
      return;
    }
    const range = getPresetRange(key);
    onPresetChange(key, range);
  }

  return (
    <div className="flex rounded-md border">
      {presets.map((p, i) => (
        <Button
          key={p.key}
          variant={activePreset === p.key ? "default" : "ghost"}
          size="sm"
          className={`text-xs h-8 ${i === 0 ? "rounded-r-none" : i === presets.length - 1 ? "rounded-l-none" : "rounded-none"}`}
          onClick={() => handleClick(p.key)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

export type { PresetKey };
