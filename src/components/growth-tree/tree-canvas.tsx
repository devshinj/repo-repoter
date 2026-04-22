"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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
import { cloudSmall, cloudMedium } from "./sprites/cloud";
import { languageColor } from "@/components/data-display/language-badge";

const CANVAS_W = 240;
const CANVAS_H = 280;
const GRID_W = 120;
const GRID_H = 140;
const SCALE = CANVAS_W / GRID_W;

// 레이아웃 상수 (그리드 좌표)
// GROUND_Y를 기준점으로 모든 오브젝트 바닥을 정렬한다.
const GROUND_Y = 128;
const TREE_SPRITE_H = 24;
const CHARACTER_SPRITE_H = 16;
const EMPTY_POT_H = 8;

const TREE_X = 44;
const TREE_Y = GROUND_Y - TREE_SPRITE_H; // 나무 화분 바닥이 지면에 닿음
const POT_X = 48;
const POT_Y = GROUND_Y - EMPTY_POT_H; // 빈 화분 바닥이 지면에 닿음
const CHARACTER_X = 80;
const CHARACTER_Y = GROUND_Y - CHARACTER_SPRITE_H; // 캐릭터 발이 지면에 닿음

type LeafColors = { leafDark: string; leafMid: string; leafLight: string } | null;

function resolveColor(cell: SpriteCell, leafOverride: LeafColors): string | null {
  if (cell === "_") return null;
  if (leafOverride && (cell === "leafDark" || cell === "leafMid" || cell === "leafLight")) {
    return leafOverride[cell];
  }
  const base = palette[cell as PaletteKey];
  return base ?? null;
}

function isLeafCell(cell: SpriteCell): boolean {
  return cell === "leafDark" || cell === "leafMid" || cell === "leafLight";
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  x: number,
  y: number,
  leafOverride: LeafColors = null,
  leafOffsetY: number = 0
): void {
  for (let sy = 0; sy < sprite.length; sy++) {
    for (let sx = 0; sx < sprite[sy].length; sx++) {
      const cell = sprite[sy][sx];
      const color = resolveColor(cell, leafOverride);
      if (color) {
        const dy = isLeafCell(cell) ? leafOffsetY : 0;
        ctx.fillStyle = color;
        ctx.fillRect(x + sx, y + sy + dy, 1, 1);
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
  y: number,
  leafOffsetY: number = 0
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
          ctx.fillRect(x + fx + sx - 1, y + fy + sy - 1 + leafOffsetY, 1, 1);
        } else if (v === 2) {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.fillRect(x + fx + sx - 1, y + fy + sy - 1 + leafOffsetY, 1, 1);
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
  drawSprite(ctx, leafFallen, POT_X - 4, GROUND_Y - 2);
  if (inactiveDays >= 14) {
    drawSprite(ctx, leafFallen, POT_X + 22, GROUND_Y);
  }

  // 떨어지는 낙엽 루프 1장 (나무 상단에서 지면까지)
  const fallDuration = 4000;
  const t = (time % fallDuration) / fallDuration;
  const lx = TREE_X + 48 + Math.sin(time / 800) * 4;
  const ly = TREE_Y + t * (GROUND_Y - TREE_Y);
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
  drawSprite(ctx, emptyPot, POT_X - 4, POT_Y);
}

// 잔디 덤불 (3~4픽셀 너비, 위로 뾰족한 블레이드)
// size: 0 = 작음 (뒤/원경), 1 = 중간, 2 = 큼 (앞/근경)
function drawGrassTuft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: 0 | 1 | 2,
  light: boolean
): void {
  ctx.fillStyle = light ? palette.grassLight : palette.grassDark;
  if (size === 0) {
    // 작은 한 뭉치: 2블레이드
    ctx.fillRect(x, y, 1, 1);
    ctx.fillRect(x + 2, y, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
  } else if (size === 1) {
    // 중간: 3블레이드
    ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillRect(x + 2, y, 1, 2);
    ctx.fillRect(x + 4, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + 2, 4, 1);
  } else {
    // 큰: 5블레이드 + 바닥선
    ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillRect(x + 2, y, 1, 3);
    ctx.fillRect(x + 4, y + 1, 1, 2);
    ctx.fillRect(x + 6, y + 2, 1, 1);
    ctx.fillRect(x - 1, y + 3, 8, 1);
  }
}

// 하늘에 떠다니는 구름 (상단 여백 포인트)
function drawClouds(ctx: CanvasRenderingContext2D, time: number): void {
  // 큰 뭉게구름 — 중앙 상단 (폭 45)
  const cx1 = 38 + Math.sin(time / 1400) * 6;
  const cy1 = 2 + Math.sin(time / 900) * 1.2;
  drawSprite(ctx, cloudMedium, Math.round(cx1), Math.round(cy1));

  // 중간 구름 — 좌측 하단 (폭 20)
  const cx2 = -4 + Math.sin(time / 1100 + 1.7) * 5;
  const cy2 = 30 + Math.sin(time / 800 + 0.9) * 1.2;
  drawSprite(ctx, cloudSmall, Math.round(cx2), Math.round(cy2));

  // 중간 구름 — 우측 하단 (폭 20)
  const cx3 = 92 + Math.sin(time / 1300 + 3.2) * 5;
  const cy3 = 34 + Math.sin(time / 950 + 2.1) * 1.2;
  drawSprite(ctx, cloudSmall, Math.round(cx3), Math.round(cy3));
}

// 지면 + 잔디 (원근감)
function drawGround(ctx: CanvasRenderingContext2D): void {
  // 은은한 지면 그림자 (화분 바닥선 기준)
  ctx.fillStyle = palette.groundShadow;
  // 넓은 타원 대신 얇은 가로 띠 — 픽셀 아트 느낌
  const gy = GROUND_Y;
  ctx.fillRect(30, gy, 60, 1);
  ctx.fillRect(26, gy + 1, 68, 1);
  ctx.fillRect(22, gy + 2, 76, 1);

  // 뒷줄 잔디 (작음, 흐림) — 화분 뒤편
  drawGrassTuft(ctx, 22, gy - 2, 0, true);
  drawGrassTuft(ctx, 92, gy - 2, 0, true);
  drawGrassTuft(ctx, 40, gy - 2, 0, true);
  drawGrassTuft(ctx, 72, gy - 2, 0, true);

  // 중간 잔디 (옆 양쪽)
  drawGrassTuft(ctx, 14, gy + 2, 1, false);
  drawGrassTuft(ctx, 100, gy + 2, 1, false);

  // 앞줄 잔디 (크고 진함) — 화분 앞
  drawGrassTuft(ctx, 28, gy + 5, 2, false);
  drawGrassTuft(ctx, 88, gy + 5, 2, false);
  drawGrassTuft(ctx, 8, gy + 7, 1, false);
  drawGrassTuft(ctx, 104, gy + 7, 1, false);
}

interface TreeCanvasProps {
  metrics: TreeMetrics;
}

export function TreeCanvas({ metrics }: TreeCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef(metrics);
  useLayoutEffect(() => {
    metricsRef.current = metrics;
  });

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

    // 배경 (모든 상태에서 공통)
    drawClouds(ctx, time);
    drawGround(ctx);

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

    // 잎 desaturate 색을 프레임당 1번만 계산
    const leafOverride: LeafColors = desat > 0 ? {
      leafDark: desaturate(palette.leafDark, desat),
      leafMid: desaturate(palette.leafMid, desat),
      leafLight: desaturate(palette.leafLight, desat),
    } : null;

    // 바람 흔들림 (잎만 — 줄기/화분은 흔들리지 않음)
    const windShift = Math.sin(time / 2000) * 0.7;
    // 숨쉬기 루프: ~1.5초 주기로 잎 덩어리가 위아래 1px 왕복 (들숨/날숨 2단계)
    const breatheRaw = Math.sin(time / 500);
    const breathe = breatheRaw < -0.3 ? -1 : breatheRaw > 0.3 ? 1 : 0;

    // 1. 나무 (sprite에 화분/흙 포함)
    drawSprite(ctx, stage.sprite, TREE_X + windShift, TREE_Y, leafOverride, breathe);

    // 3. 줄기 두께 오버레이
    drawTrunkOverlay(ctx, stage, thickness, TREE_X + windShift, TREE_Y);

    // 4. 열매
    drawFruits(ctx, stage, m.repos, TREE_X + windShift, TREE_Y, breathe);

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
