import type { PaletteKey } from "@/components/growth-tree/palette";

export type SpriteCell = PaletteKey | "_";
export type Sprite = SpriteCell[][];

export interface TreeStage {
  name: string;
  sprite: Sprite;
  /** 줄기 픽셀 좌표 (y, x) — 두께 오버레이용 */
  trunkCoords: Array<[number, number]>;
  /** 열매가 열릴 수 있는 슬롯 좌표 (y, x) — 최대 10개 */
  fruitSlots: Array<[number, number]>;
  /** 잎 픽셀 좌표 — 채도 감소 대상 */
  leafCoords: Array<[number, number]>;
}

function parsePixels(rows: string[]): Sprite {
  const map: Record<string, PaletteKey> = {
    tD: "trunkDark",
    tL: "trunkLight",
    lD: "leafDark",
    lM: "leafMid",
    lL: "leafLight",
    so: "soil",
    pR: "potRim",
    pB: "potBase",
  };
  return rows.map((row) => {
    const cells: SpriteCell[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const token = row.slice(i, i + 2);
      if (token === "__") cells.push("_");
      else cells.push(map[token] ?? "_");
    }
    return cells;
  });
}

function collectCoords(sprite: Sprite, keys: PaletteKey[]): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  for (let y = 0; y < sprite.length; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      const cell = sprite[y][x];
      if (cell !== "_" && keys.includes(cell)) {
        coords.push([y, x]);
      }
    }
  }
  return coords;
}

function makeStage(name: string, rows: string[], fruitSlots: Array<[number, number]>): TreeStage {
  const sprite = parsePixels(rows);
  for (const [y, x] of fruitSlots) {
    const cell = sprite[y]?.[x];
    if (cell !== "leafDark" && cell !== "leafMid" && cell !== "leafLight") {
      console.warn(`[growth-tree] ${name} fruitSlot [${y},${x}] lands on '${cell}', not a leaf`);
    }
  }
  return {
    name,
    sprite,
    trunkCoords: collectCoords(sprite, ["trunkDark", "trunkLight"]),
    leafCoords: collectCoords(sprite, ["leafDark", "leafMid", "leafLight"]),
    fruitSlots,
  };
}

// Stage 0: 씨앗 (흙 위 점 하나)
export const stage0_seed = makeStage(
  "seed",
  [
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "____________pRpRpRpRpR__________",
    "__________pRsotDtDsopR__________",
    "____________pBpBpBpB____________",
  ],
  []
);

// Stage 1: 떡잎 (두 개의 둥근 떡잎)
export const stage1_sprout = makeStage(
  "sprout",
  [
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "__________lMlM______lMlM________",
    "________lMlLlMlM__lMlLlMlM______",
    "________lMlMlMlM__lMlMlMlM______",
    "__________lMlM______lMlM________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "____________pRpRpRpRpR__________",
    "__________pRsotDtDsopR__________",
    "____________pBpBpBpB____________",
  ],
  []
);

// Stage 2: 묘목 — 작고 둥근 잎덩이 하나
export const stage2_sapling = makeStage(
  "sapling",
  [
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "______________lMlM______________",
    "__________lMlMlMlMlMlM__________",
    "________lMlMlLlMlMlMlMlM________",
    "________lMlLlLlMlMlMlMlM________",
    "________lMlMlMlMlMlMlMlM________",
    "__________lMlMlMlMlMlM__________",
    "______________lMlM______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "__________pRpRpRpRpRpR__________",
    "________pRsosososososopR________",
    "__________pBpBpBpBpBpB__________",
  ],
  [[6, 6], [8, 9]]
);

// Stage 3: 어린나무 — 둥근 구름 하나, 좌우 대칭
export const stage3_young = makeStage(
  "young",
  [
    "________________________________",
    "____________lMlMlMlM____________",
    "________lMlMlMlMlMlMlMlM________",
    "______lMlMlLlMlMlMlLlMlM________",
    "____lMlMlLlLlMlMlMlLlLlMlM______",
    "____lMlMlMlMlMlMlMlMlMlMlM______",
    "____lMlMlMlMlMlMlMlMlMlMlM______",
    "______lMlMlMlMlMlMlMlMlM________",
    "________lMlMlMlMlMlMlM__________",
    "____________lMlMlMlM____________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "__________pRpRpRpRpRpR__________",
    "________pRsosososososopR________",
    "__________pBpBpBpBpBpB__________",
  ],
  [[2, 8], [3, 5], [5, 12], [6, 2], [7, 11], [8, 7]]
);

// Stage 4: 중간나무 — 구름 2개 쌓인 둥근 실루엣
export const stage4_medium = makeStage(
  "medium",
  [
    "____________lMlMlMlM____________",
    "________lMlMlMlMlMlMlMlM________",
    "______lMlMlLlMlMlMlLlMlM________",
    "____lMlMlLlLlMlMlMlLlLlMlM______",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlM____",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlM____",
    "__lMlMlLlMlMlMlMlMlMlMlLlMlM____",
    "____lMlMlMlMlMlMlMlMlMlMlM______",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlM____",
    "__lMlMlLlMlMlMlMlMlMlMlLlMlM____",
    "____lMlMlMlMlMlMlMlMlMlMlM______",
    "______lMlMlMlMlMlMlMlMlM________",
    "__________lMlMlMlMlMlM__________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "__________pRpRpRpRpRpR__________",
    "________pRsosososososopR________",
    "__________pBpBpBpBpBpB__________",
  ],
  [[2, 5], [2, 9], [4, 2], [4, 12], [6, 6], [6, 10], [9, 3], [9, 11]]
);

// Stage 5: 큰나무 — 크고 풍성한 둥근 수관
export const stage5_large = makeStage(
  "large",
  [
    "__________lMlMlMlMlMlM__________",
    "______lMlMlMlMlMlMlMlMlMlM______",
    "____lMlMlLlMlMlMlMlMlLlMlM______",
    "__lMlMlLlLlMlMlMlMlMlLlLlMlM____",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlM__",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlM__",
    "lMlMlLlMlMlMlMlMlMlMlMlMlLlMlM__",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlM____",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlM__",
    "lMlMlLlMlMlMlMlMlMlMlMlMlLlMlM__",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlM__",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlM____",
    "____lMlMlMlMlMlMlMlMlMlMlM______",
    "______lMlMlMlMlMlMlMlMlM________",
    "__________lMlMlMlMlMlM__________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "__________pRpRpRpRpRpR__________",
    "________pRsosososososopR________",
    "__________pBpBpBpBpBpB__________",
  ],
  [[0, 7], [2, 5], [2, 10], [4, 1], [4, 13], [6, 2], [6, 12], [9, 5], [9, 12], [12, 7]]
);

// Stage 6: 거목 — 더 크고 풍성한 수관, 좌우 비죽 가지
export const stage6_giant = makeStage(
  "giant",
  [
    "__________lMlMlMlMlMlM__________",
    "______lMlMlMlMlMlMlMlMlMlM______",
    "____lMlMlLlMlMlMlMlMlLlMlM______",
    "__lMlMlLlLlMlMlMlMlMlLlLlMlM____",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlMlM",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlMlM",
    "lMlMlLlMlMlMlMlMlMlMlMlMlLlMlMlM",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlMlM",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlMlM",
    "lMlMlLlMlMlMlMlMlMlMlMlMlLlMlMlM",
    "lMlMlMlMlMlMlMlMlMlMlMlMlMlMlMlM",
    "__lMlMlMlMlMlMlMlMlMlMlMlMlMlM__",
    "____lMlMlMlMlMlMlMlMlMlMlMlM____",
    "______lMlMlMlMlMlMlMlMlMlM______",
    "__________lMlMlMlMlMlM__________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "______________tDtD______________",
    "__________pRpRpRpRpRpR__________",
    "________pRsosososososopR________",
    "__________pBpBpBpBpBpB__________",
  ],
  [[0, 7], [2, 5], [2, 10], [4, 1], [4, 14], [6, 2], [6, 12], [9, 5], [9, 10], [12, 7]]
);

export const treeStages: TreeStage[] = [
  stage0_seed,
  stage1_sprout,
  stage2_sapling,
  stage3_young,
  stage4_medium,
  stage5_large,
  stage6_giant,
];
