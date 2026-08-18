// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CrewQrCode } from "./CrewQrCode";

describe("CrewQrCode", () => {
  it("renders a scannable SVG for a crew link", async () => {
    render(<CrewQrCode url="https://halo.example.com/portal/tok123" label="Portal QR" />);
    const holder = screen.getByRole("img", { name: "Portal QR" });
    await waitFor(() => {
      expect(holder.querySelector("svg")).not.toBeNull();
    });
    // A QR with no quiet zone or no modules would not scan; assert real paths.
    const svg = holder.querySelector("svg")!;
    expect(svg.innerHTML.length).toBeGreaterThan(100);
  });
});
