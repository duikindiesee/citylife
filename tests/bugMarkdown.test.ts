import { describe, expect, it } from "vitest";

import {
  MAX_BODY_CHARS,
  bugMarkdownPlainText,
  bugMarkdownToHtml,
  classifyBugHref,
  collectBugDocumentFetchTargets,
  renderBugMarkdown,
  sanitizeBugText,
  type BugMarkdownDocument,
  type BugMermaidBlock,
} from "../src/colony/bug/bugMarkdown";

function blockKinds(document: BugMarkdownDocument): readonly string[] {
  return document.blocks.map((block) => block.kind);
}

describe("bugMarkdown — block structure", () => {
  it("parses the block kinds a bug body actually uses", () => {
    const document = renderBugMarkdown(
      [
        "# Kerb overshoot",
        "",
        "The cap sticks into the road.",
        "",
        "1. Spawn at camp",
        "2. Walk north",
        "",
        "- one",
        "- two",
        "",
        "> operator note",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
      ].join("\n"),
    );
    expect(blockKinds(document)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "rule",
    ]);
    const ordered = document.blocks[2];
    const bulleted = document.blocks[3];
    expect(ordered.kind === "list" && ordered.ordered).toBe(true);
    expect(bulleted.kind === "list" && bulleted.ordered).toBe(false);
  });

  it("keeps inline emphasis, strong and code, and honours a backslash escape", () => {
    const document = renderBugMarkdown(
      "a *b* **c** `d` and \\*not emphasis\\*",
    );
    const html = bugMarkdownToHtml(document);
    expect(html).toBe(
      "<p>a <em>b</em> <strong>c</strong> <code>d</code> and *not emphasis*</p>",
    );
  });

  it("returns a deep-frozen document", () => {
    const document = renderBugMarkdown("# hi\n\ntext");
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.blocks)).toBe(true);
    expect(Object.isFrozen(document.blocks[0])).toBe(true);
  });

  it("bounds the body size", () => {
    expect(() =>
      renderBugMarkdown("x".repeat(MAX_BODY_CHARS + 1)),
    ).toThrowError(/exceeds/);
  });
});

describe("bugMarkdown — raw HTML has no way in", () => {
  it("renders a script tag as text, not as an element (two-sided)", () => {
    const document = renderBugMarkdown(
      "before <script>alert(1)</script> after\n\n<img src=x onerror=alert(1)>",
    );
    const html = bugMarkdownToHtml(document);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    // No `<` from the source survives unescaped, so no attribute — onerror included — can attach to
    // anything. Checking for the literal word would be wrong: it is fine, and expected, as TEXT.
    expect(
      html.replace(
        /<\/?(p|em|strong|code|a|h[1-6]|ul|ol|li|pre|blockquote|hr)\b[^>]*>/g,
        "",
      ),
    ).not.toContain("<");
    // Positive side: the text survives, escaped, so nothing of the report was silently eaten.
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes markup inside a fenced code block", () => {
    const html = bugMarkdownToHtml(
      renderBugMarkdown("```\n</code></pre><script>alert(1)</script>\n```"),
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;/code&gt;&lt;/pre&gt;");
  });

  it("strips control characters and BIDI overrides before parsing", () => {
    // Written as escapes on purpose: a literal U+202E in the source would make this very file read
    // backwards to the next person, and a literal NUL makes git treat the test as a binary blob.
    const hostile =
      "expected: the door \u202Esnepo\u202C\u0000 now\u2028and\u202Athen\uFEFF";
    expect(sanitizeBugText(hostile)).toBe(
      "expected: the door snepo nowandthen",
    );
    const text = bugMarkdownPlainText(renderBugMarkdown(hostile));
    for (const code of [0x202e, 0x202c, 0x0000, 0x2028])
      expect(text.includes(String.fromCodePoint(code))).toBe(false);
  });
});

describe("bugMarkdown — link scheme policy", () => {
  it("accepts the allowlisted schemes and refuses the rest", () => {
    for (const good of [
      "https://kooker.co.za/a",
      "http://localhost:5173/x",
      "mailto:ops@kooker.co.za",
      "citylife://capture/bugcap_1234",
    ])
      expect(classifyBugHref(good).ok).toBe(true);

    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "kerb-overshoot",
    ])
      expect(classifyBugHref(bad).ok).toBe(false);
  });

  it("refuses a scheme split by an embedded control character", () => {
    // Browsers strip tab/newline out of a URL before resolving its scheme, so `java\tscript:` is a
    // working javascript: URL that a naive split(":")[0] reads as the harmless scheme "java".
    for (const bypass of [
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "java\rscript:alert(1)",
      "java\u0000script:alert(1)",
      "java script:alert(1)",
    ]) {
      const result = classifyBugHref(bypass);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("UNSAFE_CHARACTERS");
    }
  });

  it("renders an allowed link and degrades a refused one to visible text (two-sided)", () => {
    const document = renderBugMarkdown(
      "[good](https://kooker.co.za/a) and [bad](javascript:alert(1))",
    );
    const html = bugMarkdownToHtml(document);
    expect(html).toContain(
      '<a href="https://kooker.co.za/a" rel="noopener noreferrer nofollow" target="_blank">good</a>',
    );
    expect(html).not.toContain("javascript:alert(1)</a>");
    expect(html).not.toContain('href="javascript');
    // Refused, but not silently: the label stays and the URL is shown as literal code.
    expect(html).toContain("bad<code>javascript:alert(1</code>");
    expect(document.rejectedLinks).toEqual([
      { raw: "javascript:alert(1", reason: "DISALLOWED_SCHEME" },
    ]);
  });

  it("re-validates the href when exporting, so a hand-built document cannot smuggle one through", () => {
    const document = renderBugMarkdown("[ok](https://kooker.co.za/a)");
    const tampered = JSON.parse(JSON.stringify(document)) as {
      blocks: { spans: { href: string }[] }[];
    };
    tampered.blocks[0].spans[0].href = "javascript:alert(1)";
    const html = bugMarkdownToHtml(tampered as unknown as BugMarkdownDocument);
    expect(html).not.toContain("javascript");
    expect(html).toBe("<p>ok</p>");
  });

  it("autolinks a bare allowlisted URL and leaves a bare disallowed one as text", () => {
    const good = bugMarkdownToHtml(
      renderBugMarkdown("see https://kooker.co.za/a for detail"),
    );
    expect(good).toContain('href="https://kooker.co.za/a"');
    const bad = bugMarkdownToHtml(
      renderBugMarkdown("see javascript:alert(1) for detail"),
    );
    expect(bad).not.toContain("<a ");
    expect(bad).toContain("javascript:alert(1)");
  });

  it("escapes ampersands and quotes in an accepted href", () => {
    const html = bugMarkdownToHtml(
      renderBugMarkdown("[q](https://kooker.co.za/s?a=1&b=2)"),
    );
    expect(html).toContain('href="https://kooker.co.za/s?a=1&amp;b=2"');
  });
});

describe("bugMarkdown — a rendered body never fetches", () => {
  it("refuses an image and keeps its alt text and URL visible", () => {
    const document = renderBugMarkdown(
      "![the broken kerb](https://tracker.example.com/beacon.png)",
    );
    expect(document.rejectedImages).toEqual([
      { raw: "https://tracker.example.com/beacon.png", reason: "REMOTE_IMAGE" },
    ]);
    const html = bugMarkdownToHtml(document);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.example.com");
    expect(html).toContain("the broken kerb");
  });

  it("reports no fetch target for a deliberately hostile body (two-sided)", () => {
    const document = renderBugMarkdown(
      [
        "![beacon](https://tracker.example.com/a.png)",
        "",
        "<img src=https://tracker.example.com/b.png>",
        "",
        "[link](https://kooker.co.za/ok)",
        "",
        "```mermaid",
        "flowchart TD",
        "  A[start] --> B[end]",
        "```",
      ].join("\n"),
    );
    expect(collectBugDocumentFetchTargets(document)).toEqual([]);
    // Two-sided: the document really does contain a rendered diagram and a live link, so "no fetch
    // targets" is a property of the design rather than of an empty document.
    expect(blockKinds(document)).toContain("mermaid");
    expect(bugMarkdownToHtml(document)).toContain(
      'href="https://kooker.co.za/ok"',
    );
  });
});

describe("bugMarkdown — Mermaid renders locally or degrades", () => {
  it("parses and lays out a fenced mermaid block at parse time", () => {
    const document = renderBugMarkdown(
      [
        "```mermaid",
        "flowchart LR",
        "  A[press E] --> B[door opens]",
        "```",
      ].join("\n"),
    );
    const block = document.blocks[0] as BugMermaidBlock;
    expect(block.kind).toBe("mermaid");
    expect(block.error).toBeNull();
    expect(block.render?.diagram.nodes.map((node) => node.label)).toEqual([
      "press E",
      "door opens",
    ]);
    expect(bugMarkdownToHtml(document)).toContain("<svg");
  });

  it("degrades a broken diagram to a code block without losing the rest of the report", () => {
    const document = renderBugMarkdown(
      [
        "## Repro",
        "",
        "```mermaid",
        "sequenceDiagram",
        "  Alice->>Bob: hi",
        "```",
        "",
        "The rest of the report still matters.",
      ].join("\n"),
    );
    const block = document.blocks[1] as BugMermaidBlock;
    expect(block.render).toBeNull();
    expect(block.error).toMatch(/not supported/);
    expect(document.diagnostics).toHaveLength(1);
    expect(blockKinds(document)).toEqual(["heading", "mermaid", "paragraph"]);
    const html = bugMarkdownToHtml(document);
    expect(html).toContain("The rest of the report still matters.");
    expect(html).toContain("<pre><code>sequenceDiagram");
  });

  it("escapes a hostile node label in the exported SVG", () => {
    const html = bugMarkdownToHtml(
      renderBugMarkdown(
        [
          "```mermaid",
          "flowchart TD",
          '  A["<script>alert(1)</script>"] --> B[x]',
          "```",
        ].join("\n"),
      ),
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});
