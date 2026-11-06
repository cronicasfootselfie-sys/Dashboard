import { describe, expect, it } from "vitest";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import { MAX_PAGE_SIZE, parsePageSize, toPlain } from "./data";

describe("toPlain", () => {
  it("convierte Timestamp anidados a { seconds, nanoseconds }", () => {
    const ts = new Timestamp(1_766_016_000, 123);
    expect(
      toPlain({
        date: ts,
        labels: { "a@b.pe": { labeledAt: ts, isCorrectFoot: true } },
        list: [ts, 1, "x", null],
        geo: new GeoPoint(-12, -77),
      })
    ).toEqual({
      date: { seconds: 1_766_016_000, nanoseconds: 123 },
      labels: { "a@b.pe": { labeledAt: { seconds: 1_766_016_000, nanoseconds: 123 }, isCorrectFoot: true } },
      list: [{ seconds: 1_766_016_000, nanoseconds: 123 }, 1, "x", null],
      geo: { latitude: -12, longitude: -77 },
    });
  });
});

describe("parsePageSize", () => {
  it("usa el valor por defecto si no viene", () => {
    expect(parsePageSize(null)).toBe(20);
    expect(parsePageSize("")).toBe(20);
  });

  it("limita al máximo", () => {
    expect(parsePageSize("5000")).toBe(MAX_PAGE_SIZE);
  });

  it("rechaza valores inválidos", () => {
    for (const bad of ["0", "-1", "abc", "2.5"]) {
      expect(() => parsePageSize(bad)).toThrowError("BAD_LIMIT");
    }
  });
});
