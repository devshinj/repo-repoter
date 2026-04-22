import type { PaletteKey } from "@/components/growth-tree/palette";
import type { Sprite, SpriteCell } from "./tree-stages";

function parsePixels(rows: string[]): Sprite {
  const map: Record<string, PaletteKey> = {
    cL: "cloudLight",
    cS: "cloudShadow",
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

// 중간 구름 (26x10) — 풍성한 뭉게구름
export const cloudSmall: Sprite = parsePixels([
  "________________cLcLcLcLcLcL____________",
  "__________cLcLcLcLcLcLcLcLcLcL__________",
  "________cLcLcLcLcLcLcLcLcLcLcLcLcL______",
  "______cLcLcLcLcLcLcLcLcLcLcLcLcLcLcL____",
  "__cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL",
  "__cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL",
  "____cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL__",
  "______cLcLcLcLcLcLcLcLcLcLcLcLcLcLcL____",
  "________cLcLcLcLcLcLcLcLcLcLcLcLcL______",
  "________cScScScScScScScScScScScScS______",
]);

// 큰 구름 (42x12) — 3봉우리 대형 뭉게구름
export const cloudMedium: Sprite = parsePixels([
  "______________________cLcLcLcLcLcL____________________________cLcLcLcLcL__________________",
  "__________________cLcLcLcLcLcLcLcLcLcL________________cLcLcLcLcLcLcLcLcLcL________________",
  "________________cLcLcLcLcLcLcLcLcLcLcLcL__________cLcLcLcLcLcLcLcLcLcLcLcL________________",
  "________cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL__________",
  "____cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL______",
  "__cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL____",
  "__cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL____",
  "____cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL______",
  "________cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL__________",
  "____________cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL__________________",
  "________________cLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcLcL__________________________",
  "________________cScScScScScScScScScScScScScScScScScScScScScScScS__________________________",
]);
