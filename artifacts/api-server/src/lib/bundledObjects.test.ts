import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoAssetsDir, resolveBundledObjectFile } from "./bundledObjects";

describe("bundled Pulse photos", () => {
  it("resolves shipped Thornbury JPEGs from disk", () => {
    const dir = demoAssetsDir();
    expect(dir).toBeTruthy();
    expect(existsSync(path.join(dir!, "photo-before-1.jpg"))).toBe(true);
    const file = resolveBundledObjectFile("/objects/thornbury-pulse/photo-before-1.jpg");
    expect(file).toBeTruthy();
    expect(file!.endsWith("photo-before-1.jpg")).toBe(true);
    const buf = readFileSync(file!);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("rejects path traversal and unknown folders", () => {
    expect(resolveBundledObjectFile("/objects/thornbury-pulse/../secret.jpg")).toBeNull();
    expect(resolveBundledObjectFile("/objects/other/photo-before-1.jpg")).toBeNull();
    expect(resolveBundledObjectFile("/objects/thornbury-pulse/nope.png")).toBeNull();
  });
});
