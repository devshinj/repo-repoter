"use client";

import { stringColor, oklch } from "@/lib/color-hash";

interface LanguageBadgeProps {
  language: string | null | undefined;
}

export function languageColor(lang: string | null | undefined): string {
  if (!lang) return "#8b949e"; // fallback 회색
  const colorSet = stringColor(lang);
  return oklch(colorSet.solid);
}

export function LanguageBadge({ language }: LanguageBadgeProps) {
  if (!language) return null;

  const colorSet = stringColor(language);
  const bg = oklch(colorSet.bgLight);
  const text = oklch(colorSet.solid);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: text }}
      />
      {language}
    </span>
  );
}
