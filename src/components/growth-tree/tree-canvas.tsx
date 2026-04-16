"use client";

import { useEffect, useRef } from "react";
import type { TreeMetrics } from "@/core/types";
import { palette, desaturate, type PaletteKey } from "./palette";
import {
  stageFromCommits,
  thicknessFromMax,
  fireflyCountFromStreak,
  leafDesaturationFromInactive,
} from "./hooks/use-tree-metrics";
import { useAnimationFrame } from "./hooks/use-animation-frame";
import { treeStages, type TreeStage, type Sprite, type SpriteCell } from "./sprites/tree-stages";
import { characterIdle, characterWatering } from "./sprites/character";
import { fruit as fruitSprite } from "./sprites/fruit";
import { firefly as fireflySprite } from "./sprites/firefly";
import { leafFallen } from "./sprites/leaf-fallen";
import { emptyPot } from "./sprites/pot";
import { languageColor } from "@/components/data-display/language-badge";

const CANVAS_W = 240;
const CANVAS_H = 280;
const GRID_W = 120;
const GRID_H = 140;
const SCALE = CANVAS_W / GRID_W;

// 레이아웃 상수 (그리드 좌표)
const TREE_X = 44;
const TREE_Y = 40;
const POT_X = 48;
const POT_Y = 104;
const CHARACTER_X = 80;
const CHARACTER_Y = 100;

function resolveColor(cell: SpriteCell, leafDesatPercent: number): string | null {
  if (cell === "_") return null;
  const base = palette[cell as PaletteKey];
  if (!base) return null;
  if (leafDesatPercent > 0 && (cell === "leafDark" || cell === "leafMid" || cell === "leafLight")) {
    return desaturate(base, leafDesatPercent);
  }
  return base;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  leafDesatPercent = 0
): void {
  for (let sy = 0; sy < sprite.length; sy++) {
    for (let sx = 0; sx < sprite[sy].length; sx++) {
      const color = resolveColor(sprite[sy][sx], leafDesatPercent);
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + sx, y + sy, 1, 1);
      }
    }
  }
}

function drawTrunkOverlay(
  ctx: CanvasRenderingContext2D,
  stage: TreeStage,
  thickness: number,
  x: number,
  y: number
): void {
  if (thickness <= 0) return;
  const extraPx = Math.max(0, thickness - 1);
  ctx.fillStyle = palette.trunkDark;
  for (const [ty, tx] of stage.trunkCoords) {
    for (let dx = -extraPx; dx <= extraPx; dx++) {
      ctx.fillRect(x + tx + dx, y + ty, 1, 1);
    }
  }
}

function drawFruits(
  ctx: CanvasRenderingContext2D,
  stage: TreeStage,
  repos: TreeMetrics["repos"],
  x: number,
  y: number
): void {
  const slots = stage.fruitSlots;
  const visible = repos.slice(0, Math.min(slots.length, 10));
  for (let i = 0; i < visible.length; i++) {
    const [fy, fx] = slots[i];
    const color = languageColor(visible[i].language);
    for (let sy = 0; sy < fruitSprite.length; sy++) {
      for (let sx = 0; sx < fruitSprite[sy].length; sx++) {
        const v = fruitSprite[sy][sx];
        if (v === 1) {
          ctx.fillStyle = color;
          ctx.fillRect(x + fx + sx - 1, y + fy + sy - 1, 1, 1);
        } else if (v === 2) {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.fillRect(x + fx + sx - 1, y + fy + sy - 1, 1, 1);
        }
      }
    }
  }
}

function drawFireflies(
  ctx: CanvasRenderingContext2D,
  count: number,
  time: number
): void {
  for (let i = 0; i < count; i++) {
    const phase = i * 1.7;
    const cx = TREE_X + 30 + Math.sin(time / 1200 + phase) * 28;
    const cy = TREE_Y + 30 + Math.cos(time / 1400 + phase * 1.3) * 20;
    const alpha = 0.5 + 0.5 * Math.sin(time / 400 + phase);
    ctx.fillStyle = `rgba(255, 246, 168, ${alpha.toFixed(3)})`;
    for (let sy = 0; sy < fireflySprite.length; sy++) {
      for (let sx = 0; sx < fireflySprite[sy].length; sx++) {
        if (fireflySprite[sy][sx] === 1) {
          ctx.fillRect(Math.round(cx) + sx - 1, Math.round(cy) + sy - 1, 1, 1);
        }
      }
    }
  }
}

function drawFallenLeaves(
  ctx: CanvasRenderingContext2D,
  inactiveDays: number,
  time: number
): void {
  if (inactiveDays < 7) return;

  // 정적 낙엽 1-2장 화분 옆
  drawSprite(ctx, leafFallen, POT_X - 4, POT_Y + 22);
  if (inactiveDays >= 14) {
    drawSprite(ctx, leafFallen, POT_X + 22, POT_Y + 24);
  }

  // 떨어지는 낙엽 루프 1장
  const fallDuration = 4000;
  const t = (time % fallDuration) / fallDuration;
  const lx = TREE_X + 48 + Math.sin(time / 800) * 4;
  const ly = TREE_Y + 20 + t * 80;
  drawSprite(ctx, leafFallen, Math.round(lx), Math.round(ly));
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  todayCommitted: boolean,
  time: number
): void {
  const frames = todayCommitted ? characterWatering : characterIdle;
  const frameMs = todayCommitted ? 200 : 600;
  const frame = frames[Math.floor(time / frameMs) % frames.length];
  const yOffset = todayCommitted ? 0 : Math.sin(time / 1200) < 0 ? 1 : 0;
  drawSprite(ctx, frame, CHARACTER_X, CHARACTER_Y + yOffset);
}

function drawEmptyState(ctx: CanvasRenderingContext2D): void {
  drawSprite(ctx, emptyPot, POT_X - 4, POT_Y + 8);
}

interface TreeCanvasProps {
  metrics: TreeMetrics;
}

export function TreeCanvas({ metrics }: TreeCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  // Canvas 초기화 (devicePixelRatio 대응)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr * SCALE, dpr * SCALE);
    ctx.imageSmoothingEnabled = false;
  }, []);

  useAnimationFrame((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const m = metricsRef.current;

    // 클리어 (그리드 좌표계 기준)
    ctx.clearRect(0, 0, GRID_W, GRID_H);

    // 신규 유저 (저장소 0개) → 빈 화분만
    if (m.repos.length === 0) {
      drawEmptyState(ctx);
      drawCharacter(ctx, false, time);
      return;
    }

    const stageIdx = stageFromCommits(m.totalCommits);
    const stage = treeStages[stageIdx];
    const thickness = thicknessFromMax(m.maxDailyCommits);
    const desat = leafDesaturationFromInactive(m.inactiveDays);
    const fireflies = fireflyCountFromStreak(m.currentStreak);

    // 바람 흔들림 (전체 나무)
    const windShift = Math.sin(time / 2000) * 0.7;

    // 1. 화분
    drawSprite(ctx, emptyPot, POT_X - 4, POT_Y + 8);

    // 2. 나무
    drawSprite(ctx, stage.sprite, TREE_X + windShift, TREE_Y, desat);

    // 3. 줄기 두께 오버레이
    drawTrunkOverlay(ctx, stage, thickness, TREE_X + windShift, TREE_Y);

    // 4. 열매
    drawFruits(ctx, stage, m.repos, TREE_X + windShift, TREE_Y);

    // 5. 반딧불이
    drawFireflies(ctx, fireflies, time);

    // 6. 낙엽
    drawFallenLeaves(ctx, m.inactiveDays, time);

    // 7. 캐릭터
    drawCharacter(ctx, m.todayCommitted, time);
  });

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${CANVAS_W}px`,
        height: `${CANVAS_H}px`,
        imageRendering: "pixelated",
        display: "block",
      }}
    />
  );
}
