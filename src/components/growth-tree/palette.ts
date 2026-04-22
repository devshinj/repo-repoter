export const palette = {
  transparent: "transparent",
  trunkDark: "#6b3f1d",
  trunkLight: "#9d6b3d",
  leafDark: "#3a7d2b",
  leafMid: "#5fa347",
  leafLight: "#8fc76e",
  potBase: "#8a5a3b",
  potRim: "#6b3f1d",
  soil: "#4a2f1a",
  characterSkin: "#f5c99b",
  characterShirt: "#4f90d6",
  characterHair: "#3a2a1a",
  wateringCan: "#b8b8b8",
  water: "#7ec9f0",
  firefly: "#fff6a8",
  leafFallen: "#a68a3e",
  grassDark: "#4a7f2a",
  grassLight: "#7bb651",
  groundShadow: "#e8e1d1",
  cloudLight: "#eef2f8",
  cloudShadow: "#c4cedd",
} as const;

export type PaletteKey = keyof typeof palette;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
      case gn: h = ((bn - rn) / d + 2); break;
      case bn: h = ((rn - gn) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1/3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1/3) * 255,
  };
}

/**
 * 색의 채도를 amount 비율만큼 감소시킨다.
 * @param hex 6자리 hex 색상 문자열 ("#rrggbb"). 형식이 다르면 원본 반환.
 * @param amount 감소 비율 (0 = 원본 유지, 1 = 완전 무채색). 음수/초과값은 각각 0/1로 간주.
 * @returns 채도만 감소된 새 hex 문자열. 명도(L)는 유지된다.
 */
export function desaturate(hex: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (amount <= 0) return hex;
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const newS = Math.max(0, s * (1 - amount));
  const { r: nr, g: ng, b: nb } = hslToRgb(h, newS, l);
  return rgbToHex(nr, ng, nb);
}
