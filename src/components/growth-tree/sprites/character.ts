import type { PaletteKey } from "@/components/growth-tree/palette";
import type { Sprite, SpriteCell } from "./tree-stages";

function parsePixels(rows: string[]): Sprite {
  const map: Record<string, PaletteKey> = {
    sk: "characterSkin",
    sh: "characterShirt",
    hr: "characterHair",
    wc: "wateringCan",
    wa: "water",
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

// idle 2프레임 (숨쉬기) — 물뿌리개를 왼쪽(나무 쪽)으로 들고 있음
export const characterIdle: Sprite[] = [
  parsePixels([
    "________________________",
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wc__shshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "________shshshshshsh____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
  ]),
  parsePixels([
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wc__shshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "________shshshshshsh____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "________________________",
  ]),
];

// 물주기 4프레임 — 물뿌리개 왼쪽(나무 쪽) + 물줄기가 왼쪽 아래로 떨어짐
export const characterWatering: Sprite[] = [
  parsePixels([
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wcwcshshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "____wa__shshshshshsh____",
    "____wa____sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "________________________",
  ]),
  parsePixels([
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wcwcshshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "__wawa__shshshshshsh____",
    "__wawa____sksk__sksk____",
    "__wa______sksk__sksk____",
    "__________sksk__sksk____",
    "__________sksk__sksk____",
    "________________________",
  ]),
  parsePixels([
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wcwcshshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "__wawa__shshshshshsh____",
    "__wawa____sksk__sksk____",
    "__wawa____sksk__sksk____",
    "__wa______sksk__sksk____",
    "__________sksk__sksk____",
    "________________________",
  ]),
  parsePixels([
    "________________________",
    "__________hrhrhrhr______",
    "________hrhrhrhrhrhr____",
    "________hrsksksksksk____",
    "________hrsksksksksk____",
    "__________sksksksk______",
    "__________shshshsh______",
    "____wcwcshshshshshsh____",
    "__wcwcwcshshshshshsh____",
    "____wc__shshshshshsh____",
    "________shshshshshsh____",
    "____wa____sksk__sksk____",
    "__wawa____sksk__sksk____",
    "wa__wa____sksk__sksk____",
    "__________sksk__sksk____",
    "________________________",
  ]),
];
