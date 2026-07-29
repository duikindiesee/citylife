import { describe, expect, it } from "vitest";

import {
  BugMermaidError,
  DEFAULT_MERMAID_THEME,
  MAX_MERMAID_NODES,
  bugSvgToMarkup,
  layoutMermaidDiagram,
  mermaidSvgElements,
  parseMermaidDiagram,
  renderMermaidLocally,
  type BugSvgElement,
} from "../src/colony/bug/bugMermaid";

const SIMPLE = `flowchart TD
  A[Spawn at camp] --> B(Walk north)
  B --> C{Kerb correct?}
  C -->|no| D((File bug))
  C -.->|yes| E[Keep walking]
`;

function walk(element: BugSvgElement, visit: (node: BugSvgElement) => void): void {
  visit(element);
  for (const child of element.children) walk(child, visit);
}

describe("bugMermaid — parsing the supported subset", () => {
  it("reads nodes, shapes, edges and edge labels exactly", () => {
    const diagram = parseMermaidDiagram(SIMPLE);
    expect(diagram.direction).toBe("TD");
    expect(diagram.nodes.map((node) => [node.id, node.label, node.shape])).toEqual([
      ["A", "Spawn at camp", "rect"],
      ["B", "Walk north", "round"],
      ["C", "Kerb correct?", "diamond"],
      ["D", "File bug", "circle"],
      ["E", "Keep walking", "rect"],
    ]);
    expect(diagram.edges).toEqual([
      { from: "A", to: "B", label: null, style: "solid", arrow: true },
      { from: "B", to: "C", label: null, style: "solid", arrow: true },
      { from: "C", to: "D", label: "no", style: "solid", arrow: true },
      { from: "C", to: "E", label: "yes", style: "dotted", arrow: true },
    ]);
  });

  it("distinguishes arrow, plain, thick and dotted connectors", () => {
    const diagram = parseMermaidDiagram(`graph LR
      A --> B
      B --- C
      C ==> D
      D -.- E
    `);
    expect(diagram.edges.map((edge) => [edge.style, edge.arrow])).toEqual([
      ["solid", true],
      ["solid", false],
      ["thick", true],
      ["dotted", false],
    ]);
  });

  it("lets a later statement supply a label the first mention omitted, but never overwrite one", () => {
    const diagram = parseMermaidDiagram(`flowchart TD
      A[First name] --> B
      B[Real name] --> A[Renamed?]
    `);
    expect(diagram.nodes.map((node) => node.label)).toEqual(["First name", "Real name"]);
  });

  it("rejects the %%{init}%% directive rather than ignoring it", () => {
    // Upstream Mermaid lets this directive set securityLevel from inside the diagram source, i.e. the
    // untrusted body could disable the sanitizer that is protecting the reviewer reading it.
    expect(() =>
      parseMermaidDiagram(`%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A --> B`),
    ).toThrowError(/init.*not supported/i);
    try {
      parseMermaidDiagram(`%%{init: {}}%%\nflowchart TD\n  A --> B`);
      expect.unreachable("directive must be rejected");
    } catch (error) {
      expect((error as BugMermaidError).code).toBe("UNSUPPORTED_DIRECTIVE");
    }
  });

  it("names an unsupported diagram kind instead of failing with a syntax error", () => {
    try {
      parseMermaidDiagram("sequenceDiagram\n  Alice->>Bob: hi");
      expect.unreachable("sequenceDiagram is not supported");
    } catch (error) {
      expect((error as BugMermaidError).code).toBe("UNSUPPORTED_DIAGRAM");
      expect((error as BugMermaidError).message).toContain("sequenceDiagram");
    }
  });

  it("rejects style/class/click directives that would bind behaviour from diagram text", () => {
    for (const line of ["style A fill:#f00", "click A callback", "classDef x fill:#0f0"]) {
      try {
        parseMermaidDiagram(`flowchart TD\n  A --> B\n  ${line}`);
        expect.unreachable(`${line} must be rejected`);
      } catch (error) {
        expect((error as BugMermaidError).code).toBe("UNSUPPORTED_DIRECTIVE");
      }
    }
  });

  it("reports the offending line number", () => {
    try {
      parseMermaidDiagram("flowchart TD\n  A --> B\n  B ~~> C");
      expect.unreachable("bad edge must be rejected");
    } catch (error) {
      expect((error as BugMermaidError).line).toBe(3);
    }
  });

  it("refuses a diagram with no header", () => {
    try {
      parseMermaidDiagram("A --> B");
      expect.unreachable("header is required");
    } catch (error) {
      expect((error as BugMermaidError).code).toBe("MISSING_HEADER");
    }
  });

  it("bounds the node count", () => {
    const lines = ["flowchart TD"];
    for (let i = 0; i < MAX_MERMAID_NODES + 5; i += 1) lines.push(`  n${i}[Node ${i}]`);
    try {
      parseMermaidDiagram(lines.join("\n"));
      expect.unreachable("node bound must be enforced");
    } catch (error) {
      expect((error as BugMermaidError).code).toBe("TOO_MANY_NODES");
    }
  });
});

describe("bugMermaid — layout", () => {
  it("layers a chain and does not hang on a cycle", () => {
    // A retry loop is a normal thing for a reporter to draw. Longest-path layering written the
    // natural recursive way never terminates on it; back edges are excluded from LAYERING but are
    // still DRAWN, and which edge is the back edge is fixed by declaration order.
    const diagram = parseMermaidDiagram("flowchart TD\n  A --> B\n  B --> C\n  C --> A");
    const layout = layoutMermaidDiagram(diagram);
    expect(layout.nodes.map((node) => [node.id, node.layer])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ]);
    expect(layout.edges.map((edge) => edge.back)).toEqual([false, false, true]);
  });

  it("survives a self-loop", () => {
    const layout = layoutMermaidDiagram(
      parseMermaidDiagram("flowchart TD\n  A --> A\n  A --> B"),
    );
    expect(layout.nodes.map((node) => node.layer)).toEqual([0, 1]);
  });

  it("advances layers down the page for TD and across it for LR", () => {
    const down = layoutMermaidDiagram(parseMermaidDiagram("flowchart TD\n  A --> B"));
    const across = layoutMermaidDiagram(parseMermaidDiagram("flowchart LR\n  A --> B"));
    expect(down.nodes[1].y).toBeGreaterThan(down.nodes[0].y);
    expect(down.nodes[1].x).toBe(down.nodes[0].x);
    expect(across.nodes[1].x).toBeGreaterThan(across.nodes[0].x);
    expect(across.nodes[1].y).toBe(across.nodes[0].y);
  });

  it("mirrors RL against LR and BT against TD", () => {
    const lr = layoutMermaidDiagram(parseMermaidDiagram("flowchart LR\n  A --> B"));
    const rl = layoutMermaidDiagram(parseMermaidDiagram("flowchart RL\n  A --> B"));
    const td = layoutMermaidDiagram(parseMermaidDiagram("flowchart TD\n  A --> B"));
    const bt = layoutMermaidDiagram(parseMermaidDiagram("flowchart BT\n  A --> B"));
    expect(rl.nodes[1].x).toBeLessThan(rl.nodes[0].x);
    expect(lr.nodes[1].x).toBeGreaterThan(lr.nodes[0].x);
    expect(bt.nodes[1].y).toBeLessThan(bt.nodes[0].y);
    expect(td.nodes[1].y).toBeGreaterThan(td.nodes[0].y);
  });

  it("places every node inside the reported canvas", () => {
    const layout = layoutMermaidDiagram(parseMermaidDiagram(SIMPLE));
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe("bugMermaid — SVG output is a closed surface", () => {
  it("escapes a hostile label instead of emitting markup (two-sided)", () => {
    const hostile = `flowchart TD\n  A["><script>alert(1)</script>"] --> B[ok]`;
    const markup = bugSvgToMarkup(renderMermaidLocally(hostile).svg);
    // Negative: no element was created.
    expect(markup).not.toContain("<script");
    expect(markup.toLowerCase()).not.toContain("onload");
    // Positive: the text is still there, escaped — the label was not silently dropped.
    expect(markup).toContain("&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("never lets reporter text reach an attribute value", () => {
    // A quote is harmless in TEXT position and dangerous in ATTRIBUTE position. The guarantee worth
    // pinning is therefore structural: labels only ever appear as element text.
    const svg = renderMermaidLocally(`flowchart TD\n  A[say "hi" now] --> B[ok]`).svg;
    const attrValues: string[] = [];
    const textValues: string[] = [];
    walk(svg, (node) => {
      attrValues.push(...Object.values(node.attrs));
      if (node.text !== null) textValues.push(node.text);
    });
    expect(attrValues.some((value) => value.includes("hi"))).toBe(false);
    expect(textValues).toContain('say "hi" now');
  });

  it("emits no attribute that would make a renderer fetch anything", () => {
    const svg = renderMermaidLocally(SIMPLE).svg;
    const attrs = new Set<string>();
    walk(svg, (node) => {
      for (const name of Object.keys(node.attrs)) attrs.add(name.toLowerCase());
    });
    for (const fetching of ["src", "href", "xlink:href", "data", "poster", "srcset"])
      expect(attrs.has(fetching)).toBe(false);
    // Two-sided: the element really does carry attributes, so the assertion above is not vacuous.
    expect(attrs.has("viewbox")).toBe(true);
  });

  it("refuses a tag or attribute outside the allowlist at serialization time", () => {
    const svg = renderMermaidLocally("flowchart TD\n  A --> B").svg;
    const withHandler: BugSvgElement = {
      ...svg,
      attrs: { ...svg.attrs, onload: "alert(1)" },
    };
    expect(() => bugSvgToMarkup(withHandler)).toThrowError(/onload/);
    const withTag = { ...svg, tag: "script" } as unknown as BugSvgElement;
    expect(() => bugSvgToMarkup(withTag)).toThrowError(/script/);
  });

  it("uses no <marker> and no id, so two diagrams in one body cannot collide", () => {
    const markup = bugSvgToMarkup(renderMermaidLocally(SIMPLE).svg);
    expect(markup).not.toContain("<marker");
    expect(markup).not.toContain(" id=");
    expect(markup).not.toContain("url(#");
    // Two-sided: an arrow head IS drawn, as a derived polygon.
    expect(markup).toContain("<polygon");
  });

  it("draws a head for --> and none for ---", () => {
    const arrows = bugSvgToMarkup(renderMermaidLocally("flowchart TD\n  A --> B").svg);
    const plain = bugSvgToMarkup(renderMermaidLocally("flowchart TD\n  A --- B").svg);
    expect(arrows).toContain("<polygon");
    expect(plain).not.toContain("<polygon");
  });

  it("is deterministic byte for byte", () => {
    const once = bugSvgToMarkup(renderMermaidLocally(SIMPLE).svg);
    const twice = bugSvgToMarkup(renderMermaidLocally(SIMPLE).svg);
    expect(once).toBe(twice);
  });

  it("keeps the full label in a title when the drawn text is shortened", () => {
    const long = "A".repeat(60);
    const markup = bugSvgToMarkup(
      renderMermaidLocally(`flowchart TD\n  A[${long}] --> B`).svg,
    );
    expect(markup).toContain(`<title>${long}</title>`);
    expect(markup).toContain("…");
  });

  it("only ever styles with the theme this module chose, never with source text", () => {
    const markup = bugSvgToMarkup(
      renderMermaidLocally("flowchart TD\n  A[x] --> B[y]").svg,
      );
    expect(markup).toContain(DEFAULT_MERMAID_THEME.nodeFill);
    expect(markup).not.toContain("style=");
    expect(markup).not.toContain("class=");
  });

  it("never mutates the layout it renders", () => {
    const layout = layoutMermaidDiagram(parseMermaidDiagram(SIMPLE));
    const before = JSON.stringify(layout);
    mermaidSvgElements(layout);
    expect(JSON.stringify(layout)).toBe(before);
    expect(Object.isFrozen(layout)).toBe(true);
  });
});
