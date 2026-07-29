// BUG.COMPOSE.1 — the Markdown body of an in-world bug report.
//
// A bug body is UNTRUSTED TEXT. It is typed by whoever is standing in the world — including, once
// bug bounties land (BUG.KCO.1), someone with a financial reason to file a lot of them — and it is
// then rendered to a REVIEWER inside the same application that holds that reviewer's session. So the
// renderer is a security boundary, and it is built like one:
//
//  1. THERE IS NO HTML PASSTHROUGH, AT ALL. `renderBugMarkdown` produces a typed BLOCK/INLINE TREE.
//     The in-world surface maps that tree to React elements, which escape by construction, so the
//     usual `dangerouslySetInnerHTML` sink never exists. `bugMarkdownToHtml` is for EXPORT (a written
//     report, a tracker comment) and escapes every text node against a fixed tag set. Raw `<script>`
//     in the source is text, because `<` is never a structural character in this grammar.
//
//  2. LINK SCHEMES ARE ALLOWLISTED, AND REJECTIONS ARE VISIBLE. `javascript:`, `data:` and `vbscript:`
//     are rejected, and so is anything carrying whitespace or control characters before its colon —
//     `java\tscript:` is the classic bypass, because browsers strip those but a naive scheme split
//     does not. A rejected link is not silently dropped: the label stays as text, the raw URL is kept
//     verbatim in the document's `rejectedLinks`, and the composer tells the reporter. Silently
//     eating part of someone's bug report is its own bug.
//
//  3. NOTHING IN A RENDERED BODY FETCHES. There is deliberately no image node type: `![](url)` would
//     make a reviewer's client hit a reporter-chosen host on open — a beacon that leaks the reviewer's
//     IP and the moment they read the report, and a way to smuggle a payload past a CSP that allows
//     images. Evidence images travel as BUG.CAPTURE.1 records instead. `collectBugDocumentFetchTargets`
//     is the executable form of this claim and the tests assert it is empty for hostile input.
//
//  4. MERMAID RENDERS LOCALLY OR NOT AT ALL. Fenced ```mermaid blocks are parsed and laid out by
//     `bugMermaid.ts` at PARSE time, so a committed document is already drawable with no CDN, no
//     script tag and no second pass. A diagram that fails to parse degrades to a code block plus a
//     diagnostic — it never rejects the reporter's whole report, because losing a page of repro steps
//     to a typo'd arrow is not a trade anyone would take.
//
// Pure and framework-agnostic: no DOM, no React, no three.js. Every function returns a new
// deep-frozen value and mutates nothing.

import {
  BugMermaidError,
  renderMermaidLocally,
  bugSvgToMarkup,
  type BugSvgElement,
  type RenderedMermaid,
} from "./bugMermaid";

export const BUG_MARKDOWN_VERSION = 1;

export type BugMarkdownErrorCode = "SOURCE_TOO_LARGE" | "TOO_MANY_BLOCKS";

export class BugMarkdownError extends Error {
  constructor(
    readonly code: BugMarkdownErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BugMarkdownError";
  }
}

export const MAX_BODY_CHARS = 64 * 1024;
export const MAX_BODY_BLOCKS = 400;
export const MAX_INLINE_DEPTH = 4;
export const MAX_HREF_CHARS = 2048;

// ---------------------------------------------------------------------------------------------
// inline model
// ---------------------------------------------------------------------------------------------

export type BugLinkScheme = "https" | "http" | "mailto" | "citylife";

/** `citylife:` is the in-world scheme a report uses to point at a capture or a presence address. */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set<BugLinkScheme>([
  "https",
  "http",
  "mailto",
  "citylife",
]);

export interface BugTextSpan {
  readonly kind: "text";
  readonly text: string;
}

export interface BugCodeSpan {
  readonly kind: "code";
  readonly text: string;
}

export interface BugEmphasisSpan {
  readonly kind: "emphasis";
  readonly spans: readonly BugInlineSpan[];
}

export interface BugStrongSpan {
  readonly kind: "strong";
  readonly spans: readonly BugInlineSpan[];
}

export interface BugLinkSpan {
  readonly kind: "link";
  readonly href: string;
  readonly scheme: BugLinkScheme;
  readonly spans: readonly BugInlineSpan[];
}

export type BugInlineSpan =
  | BugTextSpan
  | BugCodeSpan
  | BugEmphasisSpan
  | BugStrongSpan
  | BugLinkSpan;

// ---------------------------------------------------------------------------------------------
// block model
// ---------------------------------------------------------------------------------------------

export interface BugHeadingBlock {
  readonly kind: "heading";
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly spans: readonly BugInlineSpan[];
}

export interface BugParagraphBlock {
  readonly kind: "paragraph";
  readonly spans: readonly BugInlineSpan[];
}

export interface BugQuoteBlock {
  readonly kind: "quote";
  readonly spans: readonly BugInlineSpan[];
}

export interface BugListBlock {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly items: readonly (readonly BugInlineSpan[])[];
}

export interface BugCodeBlock {
  readonly kind: "code";
  /** Sanitized info string, `""` when absent. Never rendered as an attribute value. */
  readonly language: string;
  readonly text: string;
}

export interface BugMermaidBlock {
  readonly kind: "mermaid";
  readonly source: string;
  /** Already parsed and laid out — a committed document is drawable with no further work. */
  readonly render: RenderedMermaid | null;
  readonly error: string | null;
}

export interface BugRuleBlock {
  readonly kind: "rule";
}

export type BugMarkdownBlock =
  | BugHeadingBlock
  | BugParagraphBlock
  | BugQuoteBlock
  | BugListBlock
  | BugCodeBlock
  | BugMermaidBlock
  | BugRuleBlock;

export type BugRejectedReferenceReason =
  | "DISALLOWED_SCHEME"
  | "NO_SCHEME"
  | "UNSAFE_CHARACTERS"
  | "TOO_LONG"
  | "REMOTE_IMAGE";

export interface BugRejectedReference {
  /** The reporter's text, verbatim, so they can see exactly what was refused. */
  readonly raw: string;
  readonly reason: BugRejectedReferenceReason;
}

export interface BugMarkdownDiagnostic {
  readonly kind: "mermaid";
  readonly message: string;
}

export interface BugMarkdownDocument {
  readonly version: number;
  readonly blocks: readonly BugMarkdownBlock[];
  readonly rejectedLinks: readonly BugRejectedReference[];
  readonly rejectedImages: readonly BugRejectedReference[];
  readonly diagnostics: readonly BugMarkdownDiagnostic[];
}

// ---------------------------------------------------------------------------------------------
// sanitation primitives
// ---------------------------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value))
    deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/**
 * Remove control characters, Unicode line/paragraph separators, and BIDI overrides.
 *
 * The BIDI ones matter more here than anywhere else in the codebase: U+202E makes a line RENDER
 * right-to-left while it PARSES left-to-right, so "expected: the door opens" can be made to display
 * as its own opposite. In a bug report that is not a curiosity, it is a way to make a reviewer read
 * a different claim than the one on record.
 */
export function sanitizeBugText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    if (code >= 0x80 && code <= 0x9f) continue;
    if (code === 0x2028 || code === 0x2029 || code === 0xfeff) continue;
    if (code >= 0x202a && code <= 0x202e) continue;
    if (code >= 0x2066 && code <= 0x2069) continue;
    out += ch;
  }
  return out;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ClassifiedHref {
  readonly href: string;
  readonly scheme: BugLinkScheme;
}

/**
 * Decide whether a URL may become a link, returning `null` (with a reason) when it may not.
 *
 * Rejecting on ANY character at or below U+0020 anywhere in the URL is the load-bearing part. Browsers
 * strip tabs and newlines out of a URL before resolving its scheme, so `java&#9;script:alert(1)` is a
 * working `javascript:` URL that a naive `split(":")[0]` reads as the harmless scheme `java`. Whitespace
 * inside a URL is never meaningful in a bug report, so the safe rule is also the correct one.
 */
export function classifyBugHref(
  raw: string,
):
  | { ok: true; value: ClassifiedHref }
  | { ok: false; reason: BugRejectedReferenceReason } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "NO_SCHEME" };
  if (trimmed.length > MAX_HREF_CHARS) return { ok: false, reason: "TOO_LONG" };
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f)
      return { ok: false, reason: "UNSAFE_CHARACTERS" };
    if (
      ch === "<" ||
      ch === ">" ||
      ch === '"' ||
      ch === "'" ||
      ch === "`" ||
      ch === "\\"
    )
      return { ok: false, reason: "UNSAFE_CHARACTERS" };
  }
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed);
  if (!match) return { ok: false, reason: "NO_SCHEME" };
  const scheme = match[1].toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme))
    return { ok: false, reason: "DISALLOWED_SCHEME" };
  return {
    ok: true,
    value: { href: trimmed, scheme: scheme as BugLinkScheme },
  };
}

// ---------------------------------------------------------------------------------------------
// inline parsing
// ---------------------------------------------------------------------------------------------

interface ParseSink {
  readonly rejectedLinks: BugRejectedReference[];
  readonly rejectedImages: BugRejectedReference[];
  readonly diagnostics: BugMarkdownDiagnostic[];
}

const ESCAPABLE = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
  ">",
  "<",
  "~",
]);

const AUTOLINK_RE = /^(https?|mailto|citylife):[^\s<>()[\]"'`\\]+/;

function pushText(spans: BugInlineSpan[], buffer: string): string {
  if (buffer.length > 0) spans.push({ kind: "text", text: buffer });
  return "";
}

/** Length of the run of `char` starting at `index`. */
function runLength(text: string, index: number, char: string): number {
  let end = index;
  while (end < text.length && text[end] === char) end += 1;
  return end - index;
}

function parseInline(
  text: string,
  sink: ParseSink,
  depth: number,
): readonly BugInlineSpan[] {
  const spans: BugInlineSpan[] = [];
  let buffer = "";
  let index = 0;

  const nested = (inner: string): readonly BugInlineSpan[] =>
    depth + 1 >= MAX_INLINE_DEPTH
      ? [{ kind: "text", text: inner }]
      : parseInline(inner, sink, depth + 1);

  while (index < text.length) {
    const ch = text[index];

    if (
      ch === "\\" &&
      index + 1 < text.length &&
      ESCAPABLE.has(text[index + 1])
    ) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (ch === "`") {
      const fence = runLength(text, index, "`");
      const closing = text.indexOf("`".repeat(fence), index + fence);
      if (closing >= 0) {
        buffer = pushText(spans, buffer);
        spans.push({
          kind: "code",
          text: text.slice(index + fence, closing).trim(),
        });
        index = closing + fence;
        continue;
      }
    }

    // An image is parsed only so it can be REFUSED with its URL intact; see property 3.
    if (ch === "!" && text[index + 1] === "[") {
      const parsed = matchBracketLink(text, index + 1);
      if (parsed) {
        sink.rejectedImages.push({
          raw: parsed.target,
          reason: "REMOTE_IMAGE",
        });
        buffer += parsed.label;
        index = parsed.end;
        continue;
      }
    }

    if (ch === "[") {
      const parsed = matchBracketLink(text, index);
      if (parsed) {
        const classified = classifyBugHref(parsed.target);
        buffer = pushText(spans, buffer);
        if (classified.ok) {
          spans.push({
            kind: "link",
            href: classified.value.href,
            scheme: classified.value.scheme,
            spans: nested(parsed.label),
          });
        } else {
          sink.rejectedLinks.push({
            raw: parsed.target,
            reason: classified.reason,
          });
          // The label survives as text and the refused URL survives as literal code, so the reporter
          // can see what was refused rather than wondering where their link went.
          spans.push(...nested(parsed.label));
          spans.push({ kind: "code", text: parsed.target });
        }
        index = parsed.end;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && runLength(text, index, ch) >= 2) {
      const delim = ch.repeat(2);
      const closing = text.indexOf(delim, index + 2);
      if (closing > index + 2) {
        buffer = pushText(spans, buffer);
        spans.push({
          kind: "strong",
          spans: nested(text.slice(index + 2, closing)),
        });
        index = closing + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const closing = text.indexOf(ch, index + 1);
      if (closing > index + 1) {
        buffer = pushText(spans, buffer);
        spans.push({
          kind: "emphasis",
          spans: nested(text.slice(index + 1, closing)),
        });
        index = closing + 1;
        continue;
      }
    }

    const previous = index === 0 ? "" : text[index - 1];
    if (!/[A-Za-z0-9]/.test(previous)) {
      const auto = AUTOLINK_RE.exec(text.slice(index));
      if (auto) {
        // Trailing sentence punctuation belongs to the sentence, not to the URL.
        let url = auto[0];
        while (url.length > 0 && ".,;:!?".includes(url[url.length - 1]))
          url = url.slice(0, -1);
        const classified = classifyBugHref(url);
        if (classified.ok) {
          buffer = pushText(spans, buffer);
          spans.push({
            kind: "link",
            href: classified.value.href,
            scheme: classified.value.scheme,
            spans: [{ kind: "text", text: url }],
          });
          index += url.length;
          continue;
        }
      }
    }

    buffer += ch;
    index += 1;
  }

  pushText(spans, buffer);
  return spans;
}

interface BracketLink {
  readonly label: string;
  readonly target: string;
  readonly end: number;
}

/** Match `[label](target)` starting at `open` (the `[`). Returns null when the shape does not hold. */
function matchBracketLink(text: string, open: number): BracketLink | null {
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0 || text[close + 1] !== "(") return null;
  const targetEnd = text.indexOf(")", close + 2);
  if (targetEnd < 0) return null;
  return {
    label: text.slice(open + 1, close),
    target: text.slice(close + 2, targetEnd),
    end: targetEnd + 1,
  };
}

// ---------------------------------------------------------------------------------------------
// block parsing
// ---------------------------------------------------------------------------------------------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]{0,20})\s*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const RULE_RE = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const BULLET_RE = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED_RE = /^ {0,3}\d{1,9}[.)]\s+(.*)$/;

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  );
}

/**
 * Parse a bug body into a typed tree. The result is deep-frozen, so a compose surface that keeps
 * editing its own draft string cannot retroactively rewrite a document already attached to a filed
 * report — the same snapshot property `bugCapture.ts` and `bugAnnotation.ts` hold.
 */
export function renderBugMarkdown(source: string): BugMarkdownDocument {
  if (typeof source !== "string")
    throw new BugMarkdownError("SOURCE_TOO_LARGE", "body must be a string");
  if (source.length > MAX_BODY_CHARS)
    throw new BugMarkdownError(
      "SOURCE_TOO_LARGE",
      `body exceeds ${MAX_BODY_CHARS} characters`,
    );

  const sink: ParseSink = {
    rejectedLinks: [],
    rejectedImages: [],
    diagnostics: [],
  };
  const lines = sanitizeBugText(source.replace(/\r\n?/g, "\n")).split("\n");
  const blocks: BugMarkdownBlock[] = [];

  const push = (block: BugMarkdownBlock): void => {
    if (blocks.length >= MAX_BODY_BLOCKS)
      throw new BugMarkdownError(
        "TOO_MANY_BLOCKS",
        `body exceeds ${MAX_BODY_BLOCKS} blocks`,
      );
    blocks.push(block);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const width = fence[1].length;
      const language = fence[2].toLowerCase();
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(candidate);
        if (closing && closing[1][0] === marker && closing[1].length >= width) {
          index += 1;
          break;
        }
        body.push(candidate);
        index += 1;
      }
      const text = body.join("\n");
      if (language === "mermaid") {
        push(mermaidBlock(text, sink));
      } else {
        push({ kind: "code", language, text });
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        spans: parseInline(heading[2].trim(), sink, 0),
      });
      index += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const parts: string[] = [];
      while (index < lines.length) {
        const quote = QUOTE_RE.exec(lines[index]);
        if (!quote) break;
        parts.push(quote[1]);
        index += 1;
      }
      push({
        kind: "quote",
        spans: parseInline(parts.join(" ").trim(), sink, 0),
      });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      const isOrdered = ordered !== null && bullet === null;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = isOrdered
          ? ORDERED_RE.exec(current)
          : BULLET_RE.exec(current);
        if (match) {
          items.push(match[1]);
          index += 1;
          continue;
        }
        // An indented, non-blank line continues the previous item rather than starting a paragraph.
        if (items.length > 0 && /^\s{2,}\S/.test(current)) {
          items[items.length - 1] =
            `${items[items.length - 1]} ${current.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      push({
        kind: "list",
        ordered: isOrdered,
        items: items.map((item) => parseInline(item.trim(), sink, 0)),
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    push({
      kind: "paragraph",
      spans: parseInline(paragraph.join(" ").trim(), sink, 0),
    });
  }

  return deepFreeze({
    version: BUG_MARKDOWN_VERSION,
    blocks,
    rejectedLinks: sink.rejectedLinks,
    rejectedImages: sink.rejectedImages,
    diagnostics: sink.diagnostics,
  }) as BugMarkdownDocument;
}

function mermaidBlock(source: string, sink: ParseSink): BugMermaidBlock {
  try {
    return {
      kind: "mermaid",
      source,
      render: renderMermaidLocally(source),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof BugMermaidError
        ? error.message
        : "diagram could not be rendered locally";
    sink.diagnostics.push({ kind: "mermaid", message });
    return { kind: "mermaid", source, render: null, error: message };
  }
}

// ---------------------------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------------------------

function inlineText(spans: readonly BugInlineSpan[]): string {
  return spans
    .map((span) => {
      switch (span.kind) {
        case "text":
        case "code":
          return span.text;
        default:
          return inlineText(span.spans);
      }
    })
    .join("");
}

/** Plain text of the body, used for readability heuristics and for a tracker's search index. */
export function bugMarkdownPlainText(document: BugMarkdownDocument): string {
  const parts: string[] = [];
  for (const block of document.blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "quote":
        parts.push(inlineText(block.spans));
        break;
      case "list":
        for (const item of block.items) parts.push(inlineText(item));
        break;
      case "code":
        parts.push(block.text);
        break;
      case "mermaid":
        parts.push(block.source);
        break;
      case "rule":
        break;
    }
  }
  return parts.join("\n").trim();
}

/**
 * Attribute names that make a renderer issue a request. The list exists so property 3 can be CHECKED
 * rather than asserted: the walker below reports anything in the document that would cause a fetch,
 * and the tests require the result to be empty for deliberately hostile bodies.
 */
const FETCHING_ATTRS: ReadonlySet<string> = new Set([
  "src",
  "href",
  "xlink:href",
  "data",
  "poster",
  "srcset",
  "background",
  "formaction",
]);

function collectSvgFetchTargets(element: BugSvgElement, out: string[]): void {
  for (const [name, value] of Object.entries(element.attrs))
    if (FETCHING_ATTRS.has(name.toLowerCase())) out.push(value);
  for (const child of element.children) collectSvgFetchTargets(child, out);
}

/**
 * Every URL a renderer would load WITHOUT the reviewer clicking anything. Links are excluded on
 * purpose: a link navigates on click, which is a decision the reviewer makes, whereas an image or a
 * font loads on open, which is a decision the REPORTER made for them.
 */
export function collectBugDocumentFetchTargets(
  document: BugMarkdownDocument,
): readonly string[] {
  const out: string[] = [];
  for (const block of document.blocks)
    if (block.kind === "mermaid" && block.render)
      collectSvgFetchTargets(block.render.svg, out);
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------------------------
// HTML export
// ---------------------------------------------------------------------------------------------

function inlineHtml(spans: readonly BugInlineSpan[]): string {
  return spans
    .map((span) => {
      switch (span.kind) {
        case "text":
          return escapeHtml(span.text);
        case "code":
          return `<code>${escapeHtml(span.text)}</code>`;
        case "emphasis":
          return `<em>${inlineHtml(span.spans)}</em>`;
        case "strong":
          return `<strong>${inlineHtml(span.spans)}</strong>`;
        case "link": {
          // Re-validated at emit time. The parser already refused a bad scheme; checking again here
          // means a hand-built or transported document cannot smuggle one past this boundary either.
          const classified = classifyBugHref(span.href);
          if (!classified.ok) return inlineHtml(span.spans);
          return `<a href="${escapeHtml(classified.value.href)}" rel="noopener noreferrer nofollow" target="_blank">${inlineHtml(span.spans)}</a>`;
        }
      }
    })
    .join("");
}

/**
 * Serialize for EXPORT. The in-world surface does not use this — it maps the block tree to React
 * elements — so this is the one path where escaping is the only defence, and every text node goes
 * through `escapeHtml` while the tag set stays fixed and closed.
 */
export function bugMarkdownToHtml(document: BugMarkdownDocument): string {
  const parts: string[] = [];
  for (const block of document.blocks) {
    switch (block.kind) {
      case "heading":
        parts.push(
          `<h${block.level}>${inlineHtml(block.spans)}</h${block.level}>`,
        );
        break;
      case "paragraph":
        parts.push(`<p>${inlineHtml(block.spans)}</p>`);
        break;
      case "quote":
        parts.push(
          `<blockquote><p>${inlineHtml(block.spans)}</p></blockquote>`,
        );
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .map((item) => `<li>${inlineHtml(item)}</li>`)
          .join("");
        parts.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case "code":
        parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "mermaid":
        if (block.render) parts.push(bugSvgToMarkup(block.render.svg));
        else
          parts.push(
            `<pre><code>${escapeHtml(block.source)}</code></pre><p>${escapeHtml(
              block.error ?? "diagram could not be rendered locally",
            )}</p>`,
          );
        break;
      case "rule":
        parts.push("<hr/>");
        break;
    }
  }
  return parts.join("\n");
}
