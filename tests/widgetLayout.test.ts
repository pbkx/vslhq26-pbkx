import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("MCP widget scrolling", () => {
  it("keeps only the opaque control bar sticky while chart layers scroll normally", async () => {
    const css = await readFile("widget/src/original.css", "utf8");

    expect(css.match(/position:\s*sticky/g)).toHaveLength(1);
    expect(css).toMatch(/\.control-bar\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:\s*100/s);
    expect(css).toMatch(/\.control-bar\s*\{[^}]*background:\s*var\(--background\)/s);
    expect(css).toMatch(/\.original-award-axis\s*\{[^}]*position:\s*static/s);
    expect(css).toMatch(/\.original-heatmap thead\s*\{\s*position:\s*static/s);
    expect(css).toMatch(/\.original-heatmap \.sticky-name\s*\{[^}]*position:\s*static/s);
    expect(css).not.toContain("backdrop-filter");
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*min-height:\s*100%/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*100vh/s);
    expect(css).not.toMatch(/\.app-shell\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.original-visual\s*\{[^}]*isolation:\s*isolate/s);
  });

  it("uses the SDK's natural auto-resize instead of a forced nested viewport", async () => {
    const bridge = await readFile("widget/src/mcpBridge.ts", "utf8");
    const app = await readFile("widget/src/App.tsx", "utf8");

    expect(bridge).toContain("{ autoResize: true }");
    expect(bridge).not.toContain("containerDimensions");
    expect(bridge).not.toContain("--grantpilot-frame-height");
    expect(app).not.toContain("shellRef");
    expect(app).not.toContain(".scrollTo(");
  });
});
