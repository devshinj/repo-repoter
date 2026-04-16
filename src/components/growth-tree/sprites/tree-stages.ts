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
  // 검증: 모든 fruitSlot이 잎 셀 위에 있어야 함
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
    "______________tDtD______________",
    "______________tDtD______________",
    "______________sososo____________",
  ],
  []
);

// Stage 1: 떡잎
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
    "________________________________",
    "________________________________",
    "____________lMlM__lMlM__________",
    "__________lMlLlM__lMlLlM________",
    "____________lM______lM__________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________sososo____________",
  ],
  []
);

// Stage 2: 묘목
export const stage2_sapling = makeStage(
  "sapling",
  [
    "________________________________",
    "________________________________",
    "________________________________",
    "________________________________",
    "____________lMlMlM______________",
    "__________lMlLlMlM______________",
    "__________lMlLlMlM__lM__________",
    "____________lMlMlMlMlM__________",
    "______________tDlMlM____________",
    "______________tD________________",
    "____________lMtD________________",
    "__________lMlMtDlM______________",
    "__________lMlLtDlMlM____________",
    "____________lMtDlM______________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "______________tD________________",
    "____________sosososo____________",
  ],
  [[6, 6], [12, 8]]
);

// Stage 3: 어린나무
export const stage3_young = makeStage(
  "young",
  [
    "________________________________",
    "__________lMlMlM________________",
    "________lMlLlMlMlM__lMlM________",
    "______lMlMlLlMlMlMlMlLlM________",
    "______lMlLlMlDlMlMlLlMlM________",
    "________lMlMtDtDlMlMlM__________",
    "__________lMtDtDlM______________",
    "__________lMtDtDlMlMlM__________",
    "________lMlMtDtDlLlMlM__________",
    "______lMlLlMtDtDlMlMlMlM________",
    "______lMlMlMtDtDlMlLlMlM________",
    "________lMlMtDtDlMlMlM__________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "____________tDtD________________",
    "__________sosososo______________",
  ],
  [[3, 4], [4, 10], [9, 3], [10, 10]]
);

// Stage 4: 중간나무
export const stage4_medium = makeStage(
  "medium",
  [
    "__________lMlMlMlM______________",
    "________lMlLlMlMlLlMlM__________",
    "______lMlLlMlMlMlMlMlMlM________",
    "____lMlMlLlMlMlDlMlMlLlMlM______",
    "____lMlLlMlDlMlMlMlDlMlMlMlM____",
    "__lMlMlMlMlMtDtDlMlMlMlMlMlM____",
    "____lMlMlMtDtDtDtDlMlMlMlM______",
    "______lMlMtDtDtDtDlMlMlM________",
    "____lMlMtDtDtDtDlMlMlMlMlM______",
    "__lMlMlLlMtDtDtDtDlMlMlLlMlM____",
    "____lMlMlMtDtDtDtDlMlMlMlM______",
    "______lMtDtDtDtDlMlM____________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "________sosososososo____________",
  ],
  [[2, 3], [3, 6], [4, 12], [7, 3], [9, 2], [9, 12], [11, 3], [11, 9]]
);

// Stage 5: 큰나무
export const stage5_large = makeStage(
  "large",
  [
    "______lMlMlMlMlM________________",
    "____lMlLlMlMlLlMlMlM____________",
    "__lMlLlMlMlMlMlMlMlMlM__________",
    "lMlMlLlMlMlDlMlMlLlMlMlM________",
    "lMlLlMlDlMlMlMlDlMlMlMlMlM______",
    "lMlMlMlMlMtDtDlMlMlMlMlMlMlM____",
    "lMlMlMlLtDtDtDtDlMlMlLlMlMlM____",
    "__lMlMtDtDtDtDtDtDlMlMlMlM______",
    "____lMtDtDtDtDtDtDlMlMlMlM______",
    "lMlMlLtDtDtDtDtDtDlMlMlLlMlM____",
    "lMlMlMtDtDtDtDtDtDtDlMlMlMlM____",
    "lMlMlLtDtDtDtDtDtDlMlMlLlMlM____",
    "__lMlMtDtDtDtDtDtDlMlMlMlM______",
    "____lMtDtDtDtDtDtDlMlMlMlM______",
    "lMlMlLtDtDtDtDtDtDlMlMlLlMlM____",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "______sosososososososo__________",
  ],
  [[2, 2], [3, 6], [4, 11], [5, 1], [6, 12], [9, 1], [9, 12], [11, 2], [12, 10], [14, 2]]
);

// Stage 6: 거목
export const stage6_giant = makeStage(
  "giant",
  [
    "____lMlMlMlMlMlMlM______________",
    "__lMlLlMlMlLlMlMlMlM____________",
    "lMlLlMlMlMlMlMlMlMlMlM__________",
    "lMlLlMlDlMlMlLlMlDlMlMlM________",
    "lMlMlDlMlMlMlMlMlDlMlMlMlM______",
    "lMlMlMlMtDtDtDtDlMlMlMlMlMlM____",
    "lMlMlLtDtDtDtDtDtDlMlLlMlMlM____",
    "lMlMtDtDtDtDtDtDtDtDlMlMlMlM____",
    "__lMtDtDtDtDtDtDtDtDlMlMlM______",
    "lMlMlLtDtDtDtDtDtDtDlMlLlMlM____",
    "lMlMtDtDtDtDtDtDtDtDtDlMlMlMlM__",
    "lMlMlLtDtDtDtDtDtDtDlMlLlMlM____",
    "__lMtDtDtDtDtDtDtDtDlMlMlM______",
    "lMlMlLtDtDtDtDtDtDtDlMlLlMlM____",
    "lMlMtDtDtDtDtDtDtDtDlMlMlMlM____",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "__________tDtDtDtD______________",
    "____sosososososososososo________",
  ],
  [[2, 1], [3, 5], [3, 11], [5, 2], [6, 12], [7, 1], [9, 2], [9, 12], [11, 2], [13, 11]]
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
