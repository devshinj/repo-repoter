import { describe, expect, it } from "vitest";
import { desaturate, palette } from "@/components/growth-tree/palette";

describe("palette", () => {
  it("exports expected color keys", () => {
    expect(palette.trunkDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(palette.leafMid).toMatch(/^#[0-9a-f]{6}$/i);
    expect(palette.potBase).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("desaturate", () => {
  it("returns original when percent is 0", () => {
    expect(desaturate("#5fa347", 0).toLowerCase()).toBe("#5fa347");
  });

  it("reduces saturation by 20%", () => {
    const result = desaturate("#5fa347", 0.2);
    expect(result).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result).not.toBe("#5fa347");
  });

  it("reduces saturation by 40%", () => {
    const result = desaturate("#5fa347", 0.4);
    const result20 = desaturate("#5fa347", 0.2);
    expect(result).not.toBe(result20);
  });

  it("keeps gray colors unchanged regardless of percent", () => {
    const gray = "#808080";
    expect(desaturate(gray, 0.5).toLowerCase()).toBe(gray);
  });
});
