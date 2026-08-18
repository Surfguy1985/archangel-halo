import { describe, it, expect } from "vitest";
import {
  ANSWER_MAX_BULLETS,
  ANSWER_MAX_GROUP_ITEMS,
  capStructured,
  groupEnumeration,
  normalizeAnswer,
  plainTextToStructured,
  stripInlineMarkdown,
  structuredToPlainText,
} from "./answerFormat";

describe("stripInlineMarkdown", () => {
  it("removes the syntax that was leaking to the screen as literal characters", () => {
    expect(stripInlineMarkdown("**Unit 111** is done")).toBe("Unit 111 is done");
    expect(stripInlineMarkdown("`code` and __bold__ and *em*")).toBe("code and bold and em");
    expect(stripInlineMarkdown("see [the board](http://x)")).toBe("see the board");
  });

  it("leaves bare asterisks in prose alone rather than mangling text", () => {
    expect(stripInlineMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});

describe("capStructured", () => {
  it("caps bullets and moves the tail into the expander", () => {
    const out = capStructured({
      headline: "Lots going on.",
      bullets: Array.from({ length: 9 }, (_, i) => ({ text: `Item ${i}` })),
      speech: "",
    });
    expect(out.bullets).toHaveLength(ANSWER_MAX_BULLETS);
    expect(out.overflow).toHaveLength(9 - ANSWER_MAX_BULLETS);
  });

  it("keeps bullets as fragments — one clause, no trailing period", () => {
    const out = capStructured({
      headline: "Turns.",
      bullets: [{ text: "Unit 111 is running long. It has no crew assigned either." }],
      speech: "",
    });
    expect(out.bullets[0].text).toBe("Unit 111 is running long");
  });

  it("drops emphasis that does not appear in the fragment", () => {
    const out = capStructured({
      headline: "x",
      bullets: [
        { text: "Unit 111 — 5 days", emphasis: "Unit 111" },
        { text: "Unit 112 — 2 days", emphasis: "Unit 999" },
      ],
      speech: "",
    });
    expect(out.bullets[0].emphasis).toBe("Unit 111");
    expect(out.bullets[1].emphasis).toBeUndefined();
  });

  it("derives speech when the model omitted it", () => {
    const out = capStructured({
      headline: "6 units are complete.",
      bullets: [{ text: "Cedar Ridge — 4" }],
      speech: "",
    });
    expect(out.speech).toContain("6 units are complete");
    expect(out.speech).not.toContain("•");
  });

  it("caps group items and folds the rest away", () => {
    const out = capStructured({
      headline: "40 units complete.",
      bullets: [],
      groups: [{ label: "Cedar Ridge", items: Array.from({ length: 12 }, (_, i) => `Unit ${i}`) }],
      speech: "s",
    });
    expect(out.groups![0].items).toHaveLength(ANSWER_MAX_GROUP_ITEMS);
    expect(out.groups![0].hidden).toHaveLength(12 - ANSWER_MAX_GROUP_ITEMS);
  });
});

describe("plainTextToStructured", () => {
  it("converts a legacy markdown blob into bullets with no syntax left", () => {
    const out = plainTextToStructured("Here is the state.\n- **Unit 111** is stalled\n- Unit 112 is ready");
    expect(out.headline).toBe("Here is the state.");
    expect(out.bullets.map((b) => b.text)).toEqual(["Unit 111 is stalled", "Unit 112 is ready"]);
    expect(JSON.stringify(out)).not.toContain("**");
  });

  it("splits one prose blob into a headline plus bullets", () => {
    const out = plainTextToStructured(
      "Six units are complete. Cedar Ridge has four of them. Oak Park has the other two.",
    );
    expect(out.headline).toBe("Six units are complete.");
    expect(out.bullets).toHaveLength(2);
  });

  it("keeps speech conversational — no bullet characters", () => {
    const out = plainTextToStructured("- one thing\n- another thing");
    expect(out.speech).not.toMatch(/[•\-*]\s/);
  });
});

describe("normalizeAnswer", () => {
  it("falls back to the legacy text when the model ignored the schema", () => {
    const out = normalizeAnswer({}, "Two jobs are overdue. Both are at Cedar Ridge.");
    expect(out.headline).toBe("Two jobs are overdue.");
    expect(out.bullets).toHaveLength(1);
  });

  it("prefers the structured fields when present", () => {
    const out = normalizeAnswer(
      { headline: "3 overdue.", bullets: [{ text: "Unit 4 — 2 days late" }], speech: "Three are overdue." },
      "ignored legacy prose",
    );
    expect(out.headline).toBe("3 overdue.");
    expect(out.speech).toBe("Three are overdue.");
  });
});

describe("structuredToPlainText", () => {
  it("flattens without emitting markdown", () => {
    const text = structuredToPlainText({
      headline: "6 complete.",
      bullets: [{ text: "Unit 111" }],
      groups: [{ label: "Cedar Ridge", items: ["101", "102"], hidden: ["103"] }],
      speech: "s",
    });
    expect(text).toContain("• Unit 111");
    expect(text).toContain("Cedar Ridge: 101, 102 (+1 more)");
    expect(text).not.toContain("**");
  });
});

describe("groupEnumeration", () => {
  it("groups a long list instead of dumping every row", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      property: i < 25 ? "Cedar Ridge" : "Oak Park",
      unit: `Unit ${i}`,
    }));
    const { groups, hiddenCount } = groupEnumeration(rows, (r) => r.property, (r) => r.unit);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(ANSWER_MAX_GROUP_ITEMS);
    expect(groups[0].hidden!.length).toBe(25 - ANSWER_MAX_GROUP_ITEMS);
    expect(hiddenCount).toBe(0);
  });
});
