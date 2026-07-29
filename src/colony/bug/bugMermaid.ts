// BUG.COMPOSE.1 — Mermaid flowcharts, parsed and laid out LOCALLY.
//
// The operator asked for Mermaid diagrams in a bug body. The obvious implementation is a `<script
// src="https://cdn.jsdelivr.net/npm/mermaid">` tag, and it is wrong here for three separate reasons:
//
//   1. CityLife renders a bug body for a REVIEWER. A CDN tag means every reviewer who opens a report
//      makes a request to a third party, carrying their IP and a referrer that names the deployment.
//   2. Upstream Mermaid renders through `innerHTML` and has shipped XSS advisories more than once;
//      a bug body is UNTRUSTED REPORTER TEXT, so handing it to a renderer with an HTML sink is the
//      exact shape of the vulnerability.
//   3. A bug report has to still render in five years, offline, from the repo. A CDN version bump can
//      silently change or break what a filed report looks like.
//
// So this module implements the subset itself: parse → layout → an SVG ELEMENT TREE. No network, no
// DOM, no three.js, no React. Every function returns a new deep-frozen value and mutates nothing.
//
// Four properties are load-bearing and each has a matching invariant in tests/bugMermaid.test.ts:
//
//  1. NO HTML SINK EXISTS. The renderer's output is a typed element tree with an allowlisted tag set
//     and an allowlisted attribute set. `bugSvgToMarkup` is the only place it becomes a string, and it
//     escapes every text node and every attribute value. There is deliberately no `style` attribute,
//     no `href`, no `foreignObject` and no event attribute anywhere in the allowlist, so a label of
//     `"><script>alert(1)</script>` has nowhere to land.
//
//  2. A CYCLE MUST NOT HANG THE LAYOUT. Longest-path layering written the natural recursive way never
//     terminates on `A --> B --> C --> A`, and a reporter drawing a state loop is a normal thing to do.
//     Cycles are detected and the back edges excluded from LAYERING (they are still DRAWN), in
//     insertion order, so the result is deterministic rather than merely non-hanging.
//
//  3. THE `%%{init}%%` DIRECTIVE IS REJECTED, NOT IGNORED. Upstream Mermaid lets that directive set
//     `securityLevel` and inject theme CSS from inside the diagram source — i.e. the untrusted body
//     could turn its own sanitizer off. It is rejected loudly so a reporter learns their diagram was
//     not rendered as written instead of silently getting a different picture.
//
//  4. THE ARROW HEAD IS A DERIVED POLYGON, NOT AN SVG `<marker>`. Marker ids are DOCUMENT-global; two
//     diagrams in one bug body would collide and the second one's arrows would inherit the first's
//     geometry. Deriving the head from the last segment removes ids from the output entirely.
//
// The supported subset is deliberately small and is stated in docs/specs/161: `flowchart`/`graph` with
// a direction, the five common node shapes, four edge styles, optional edge labels, and node/edge
// chains. Anything else fails with a line number rather than rendering something the reporter did not
// write.

export const BUG_MERMAID_VERSION = 1;

export type BugMermaidErrorCode =
  | "EMPTY_SOURCE"
  | "SOURCE_TOO_LARGE"
  | "MISSING_HEADER"
  | "UNSUPPORTED_DIAGRAM"
  | "UNSUPPORTED_DIRECTIVE"
  | "SYNTAX"
  | "TOO_MANY_NODES"
  | "TOO_MANY_EDGES"
  | "INVALID_SVG";

export class BugMermaidError extends Error {
  constructor(
    readonly code: BugMermaidErrorCode,
    message: string,
    /** 1-based source line, or 0 when the fault is not tied to one line. */
    readonly line = 0,
  ) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.name = "BugMermaidError";
  }
}

// ---------------------------------------------------------------------------------------------
// bounds
//
// Every limit here exists because the source is UNTRUSTED. A bug body is pasted text; an accidental
// paste of a 200k-line log into a ```mermaid fence should fail fast with a message, not lock the
// reporter's tab while a quadratic layout chews through it.
// ---------------------------------------------------------------------------------------------

export const MAX_MERMAID_SOURCE_CHARS = 16_384;
export const MAX_MERMAID_LINES = 400;
export const MAX_MERMAID_NODES = 120;
export const MAX_MERMAID_EDGES = 240;
export const MAX_MERMAID_LABEL_CHARS = 160;
/** Longer labels keep their full text in a `<title>`; only the drawn text is shortened. */
export const MAX_DRAWN_LABEL_CHARS = 28;

// ---------------------------------------------------------------------------------------------
// diagram model
// ---------------------------------------------------------------------------------------------

export type MermaidDirection = "TD" | "TB" | "LR" | "RL" | "BT";
export type MermaidNodeShape =
  | "rect"
  | "round"
  | "stadium"
  | "circle"
  | "diamond";
export type MermaidEdgeStyle = "solid" | "dotted" | "thick";

export interface MermaidNode {
  readonly id: string;
  readonly label: string;
  readonly shape: MermaidNodeShape;
}

export interface MermaidEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
  readonly style: MermaidEdgeStyle;
  /** `-->` draws a head; `---` is a plain connector. */
  readonly arrow: boolean;
}

export interface MermaidDiagram {
  readonly version: number;
  readonly direction: MermaidDirection;
  /** First-declaration order. Layout ordering depends on it, so it is a contract, not an accident. */
  readonly nodes: readonly MermaidNode[];
  readonly edges: readonly MermaidEdge[];
}

// ---------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value))
    deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/**
 * Control characters, Unicode line separators and BIDI overrides are removed before anything is
 * parsed. The BIDI ones are not cosmetic: U+202E and friends make a line RENDER in a different order
 * than it PARSES (the "Trojan Source" trick), which in a bug report means the reviewer reads a
 * different diagram than the one that was drawn.
 */
function stripDangerousChars(text: string): string {
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

// ---------------------------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------------------------

const HEADER_RE = /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)$/;
const NODE_ID_RE = /^[A-Za-z0-9_.-]+/;
const EDGE_RE = /^(-\.->|-\.-|-->|---|==>|===)/;

/** Diagram kinds a reporter may plausibly reach for. Naming them produces a better error than "syntax". */
const KNOWN_UNSUPPORTED = [
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "requirementDiagram",
  "C4Context",
  "sankey-beta",
  "block-beta",
];

interface ShapeMatch {
  readonly label: string;
  readonly shape: MermaidNodeShape;
  readonly length: number;
}

/** Longest opener first: `((` must beat `(`, and `([` must beat `(`. */
const SHAPE_DELIMITERS: readonly {
  open: string;
  close: string;
  shape: MermaidNodeShape;
}[] = [
  { open: "((", close: "))", shape: "circle" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
];

function unquoteLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1).trim();
  return trimmed;
}

function matchShape(rest: string): ShapeMatch | null {
  for (const delim of SHAPE_DELIMITERS) {
    if (!rest.startsWith(delim.open)) continue;
    const closeAt = rest.indexOf(delim.close, delim.open.length);
    if (closeAt < 0) return null;
    const raw = rest.slice(delim.open.length, closeAt);
    return {
      label: unquoteLabel(raw),
      shape: delim.shape,
      length: closeAt + delim.close.length,
    };
  }
  return null;
}

interface ParsedNodeToken {
  readonly id: string;
  readonly label: string | null;
  readonly shape: MermaidNodeShape | null;
  readonly length: number;
}

function parseNodeToken(rest: string, line: number): ParsedNodeToken {
  const idMatch = NODE_ID_RE.exec(rest);
  if (!idMatch)
    throw new BugMermaidError(
      "SYNTAX",
      `expected a node id, found ${JSON.stringify(rest.slice(0, 16))}`,
      line,
    );
  const id = idMatch[0];
  const shape = matchShape(rest.slice(id.length));
  if (!shape) return { id, label: null, shape: null, length: id.length };
  return {
    id,
    label: shape.label,
    shape: shape.shape,
    length: id.length + shape.length,
  };
}

interface ParsedEdgeToken {
  readonly style: MermaidEdgeStyle;
  readonly arrow: boolean;
  readonly label: string | null;
  readonly length: number;
}

function parseEdgeToken(rest: string, line: number): ParsedEdgeToken | null {
  const match = EDGE_RE.exec(rest);
  if (!match) return null;
  const token = match[0];
  const style: MermaidEdgeStyle = token.startsWith("-.")
    ? "dotted"
    : token.startsWith("==")
      ? "thick"
      : "solid";
  const arrow = token.endsWith(">");
  let length = token.length;
  let label: string | null = null;
  const after = rest.slice(length);
  if (after.startsWith("|")) {
    const closeAt = after.indexOf("|", 1);
    if (closeAt < 0)
      throw new BugMermaidError("SYNTAX", "unterminated edge label", line);
    label = unquoteLabel(after.slice(1, closeAt));
    length += closeAt + 1;
  }
  return { style, arrow, label, length };
}

function clampLabel(label: string): string {
  const collapsed = label.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_MERMAID_LABEL_CHARS
    ? `${collapsed.slice(0, MAX_MERMAID_LABEL_CHARS - 1)}…`
    : collapsed;
}

/**
 * Parse the supported flowchart subset. Anything outside it throws with a line number: a diagram that
 * silently renders as something other than what the reporter typed is worse than one that does not
 * render at all, because only the second kind gets fixed.
 */
export function parseMermaidDiagram(source: string): MermaidDiagram {
  if (typeof source !== "string")
    throw new BugMermaidError(
      "EMPTY_SOURCE",
      "diagram source must be a string",
    );
  if (source.length > MAX_MERMAID_SOURCE_CHARS)
    throw new BugMermaidError(
      "SOURCE_TOO_LARGE",
      `diagram source exceeds ${MAX_MERMAID_SOURCE_CHARS} characters`,
    );

  const cleaned = stripDangerousChars(source.replace(/\r\n?/g, "\n"));
  const rawLines = cleaned.split("\n");
  if (rawLines.length > MAX_MERMAID_LINES)
    throw new BugMermaidError(
      "SOURCE_TOO_LARGE",
      `diagram exceeds ${MAX_MERMAID_LINES} lines`,
    );

  const nodeOrder: string[] = [];
  const nodeById = new Map<
    string,
    { label: string; shape: MermaidNodeShape }
  >();
  const edges: MermaidEdge[] = [];
  let direction: MermaidDirection | null = null;

  const declare = (token: ParsedNodeToken, line: number): void => {
    const existing = nodeById.get(token.id);
    if (!existing) {
      if (nodeOrder.length >= MAX_MERMAID_NODES)
        throw new BugMermaidError(
          "TOO_MANY_NODES",
          `diagram exceeds ${MAX_MERMAID_NODES} nodes`,
          line,
        );
      nodeOrder.push(token.id);
      nodeById.set(token.id, {
        label: clampLabel(token.label ?? token.id),
        shape: token.shape ?? "rect",
      });
      return;
    }
    // A later mention MAY supply the shape/label the first mention omitted, which is how `A --> B`
    // followed by `B[Real name]` is meant to read. It never OVERWRITES an explicit earlier label:
    // first declaration wins, so the diagram does not depend on statement order for its text.
    if (token.label !== null && existing.label === token.id) {
      existing.label = clampLabel(token.label);
      existing.shape = token.shape ?? existing.shape;
    }
  };

  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNo = index + 1;
    const line = rawLines[index].trim();
    if (line === "") continue;

    if (line.startsWith("%%{"))
      throw new BugMermaidError(
        "UNSUPPORTED_DIRECTIVE",
        "the %%{init}%% directive is not supported: it can change the renderer's own security settings from inside untrusted diagram text",
        lineNo,
      );
    if (line.startsWith("%%")) continue;

    if (direction === null) {
      const header = HEADER_RE.exec(line);
      if (header) {
        direction = header[2] as MermaidDirection;
        continue;
      }
      const firstWord = line.split(/\s+/)[0] ?? "";
      if (KNOWN_UNSUPPORTED.includes(firstWord))
        throw new BugMermaidError(
          "UNSUPPORTED_DIAGRAM",
          `only flowchart/graph diagrams render locally; '${firstWord}' is not supported`,
          lineNo,
        );
      throw new BugMermaidError(
        "MISSING_HEADER",
        "a diagram must start with 'flowchart <TD|TB|LR|RL|BT>' or 'graph <dir>'",
        lineNo,
      );
    }

    if (line === "end" || line.startsWith("subgraph "))
      throw new BugMermaidError(
        "UNSUPPORTED_DIAGRAM",
        "subgraphs are not supported by the local renderer",
        lineNo,
      );
    if (/^(style|classDef|class|click|linkStyle)\b/.test(line))
      throw new BugMermaidError(
        "UNSUPPORTED_DIRECTIVE",
        `'${line.split(/\s+/)[0]}' styles or binds behaviour from inside diagram text and is not supported`,
        lineNo,
      );

    // A statement is a chain: NODE (EDGE NODE)*
    let rest = line.endsWith(";") ? line.slice(0, -1).trim() : line;
    let previous = parseNodeToken(rest, lineNo);
    declare(previous, lineNo);
    rest = rest.slice(previous.length).trimStart();

    while (rest.length > 0) {
      const edge = parseEdgeToken(rest, lineNo);
      if (!edge)
        throw new BugMermaidError(
          "SYNTAX",
          `expected an edge (-->, ---, -.->, ==>) but found ${JSON.stringify(rest.slice(0, 12))}`,
          lineNo,
        );
      rest = rest.slice(edge.length).trimStart();
      const target = parseNodeToken(rest, lineNo);
      declare(target, lineNo);
      rest = rest.slice(target.length).trimStart();
      if (edges.length >= MAX_MERMAID_EDGES)
        throw new BugMermaidError(
          "TOO_MANY_EDGES",
          `diagram exceeds ${MAX_MERMAID_EDGES} edges`,
          lineNo,
        );
      edges.push({
        from: previous.id,
        to: target.id,
        label:
          edge.label === null || edge.label === ""
            ? null
            : clampLabel(edge.label),
        style: edge.style,
        arrow: edge.arrow,
      });
      previous = target;
    }
  }

  if (direction === null)
    throw new BugMermaidError(
      "MISSING_HEADER",
      "a diagram must start with 'flowchart <TD|TB|LR|RL|BT>' or 'graph <dir>'",
    );
  if (nodeOrder.length === 0)
    throw new BugMermaidError("EMPTY_SOURCE", "diagram declares no nodes");

  return deepFreeze({
    version: BUG_MERMAID_VERSION,
    direction,
    nodes: nodeOrder.map((id) => {
      const entry = nodeById.get(id)!;
      return { id, label: entry.label, shape: entry.shape };
    }),
    edges,
  }) as MermaidDiagram;
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

export interface MermaidPoint {
  readonly x: number;
  readonly y: number;
}

export interface MermaidLayoutNode {
  readonly id: string;
  readonly label: string;
  /** What is actually drawn inside the shape; the full label rides along in a `<title>`. */
  readonly drawnLabel: string;
  readonly shape: MermaidNodeShape;
  readonly layer: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MermaidLayoutEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
  readonly style: MermaidEdgeStyle;
  readonly arrow: boolean;
  /** True when this edge closes a cycle and was therefore excluded from LAYERING (still drawn). */
  readonly back: boolean;
  readonly points: readonly MermaidPoint[];
  readonly labelPoint: MermaidPoint | null;
}

export interface MermaidLayout {
  readonly version: number;
  readonly direction: MermaidDirection;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly MermaidLayoutNode[];
  readonly edges: readonly MermaidLayoutEdge[];
}

const NODE_HEIGHT = 44;
const MIN_NODE_WIDTH = 84;
const MAX_NODE_WIDTH = 240;
const CHAR_WIDTH = 8;
const NODE_PADDING = 18;
const GAP_ACROSS = 32;
const GAP_ALONG = 56;
const MARGIN = 16;

function drawnLabelOf(label: string): string {
  return label.length > MAX_DRAWN_LABEL_CHARS
    ? `${label.slice(0, MAX_DRAWN_LABEL_CHARS - 1)}…`
    : label;
}

function nodeWidthOf(drawn: string): number {
  return Math.min(
    MAX_NODE_WIDTH,
    Math.max(MIN_NODE_WIDTH, drawn.length * CHAR_WIDTH + NODE_PADDING * 2),
  );
}

/**
 * Mark the edges that close a cycle, in insertion order, using an ITERATIVE depth-first walk.
 *
 * Recursion is the natural way to write this and it is exactly what breaks: a reporter drawing a
 * retry loop (`A --> B --> C --> A`) is normal, and a recursive longest-path never terminates on it.
 * Iterating also means a 120-node chain cannot overflow the stack. Roots are visited in declaration
 * order so the SAME source always classifies the SAME edge as the back edge.
 */
function findBackEdges(
  nodes: readonly MermaidNode[],
  edges: readonly MermaidEdge[],
): ReadonlySet<number> {
  const outgoing = new Map<string, number[]>();
  for (const node of nodes) outgoing.set(node.id, []);
  edges.forEach((edge, index) => outgoing.get(edge.from)?.push(index));

  const back = new Set<number>();
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  for (const node of nodes) state.set(node.id, 0);

  for (const root of nodes) {
    if (state.get(root.id) !== 0) continue;
    const stack: { id: string; cursor: number }[] = [
      { id: root.id, cursor: 0 },
    ];
    state.set(root.id, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.id) ?? [];
      if (frame.cursor >= list.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edgeIndex = list[frame.cursor];
      frame.cursor += 1;
      const next = edges[edgeIndex].to;
      const nextState = state.get(next) ?? 0;
      if (nextState === 1) {
        back.add(edgeIndex); // closes a cycle
        continue;
      }
      if (nextState === 2) continue; // already resolved: a cross/forward edge, layering handles it
      state.set(next, 1);
      stack.push({ id: next, cursor: 0 });
    }
  }
  return back;
}

/** Longest-path layering over the acyclic subgraph, by Kahn order so it is O(V+E) and terminating. */
function assignLayers(
  nodes: readonly MermaidNode[],
  edges: readonly MermaidEdge[],
  back: ReadonlySet<number>,
): Map<string, number> {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, number[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  edges.forEach((edge, index) => {
    if (back.has(index)) return;
    if (edge.from === edge.to) return; // a self-loop cannot advance a layer
    outgoing.get(edge.from)?.push(index);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  });

  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    layer.set(node.id, 0);
    if ((indegree.get(node.id) ?? 0) === 0) queue.push(node.id);
  }
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    for (const edgeIndex of outgoing.get(id) ?? []) {
      const edge = edges[edgeIndex];
      const candidate = (layer.get(id) ?? 0) + 1;
      if (candidate > (layer.get(edge.to) ?? 0)) layer.set(edge.to, candidate);
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }
  return layer;
}

function anchorOut(
  node: MermaidLayoutNode,
  direction: MermaidDirection,
): MermaidPoint {
  switch (direction) {
    case "LR":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "RL":
      return { x: node.x, y: node.y + node.height / 2 };
    case "BT":
      return { x: node.x + node.width / 2, y: node.y };
    default:
      return { x: node.x + node.width / 2, y: node.y + node.height };
  }
}

function anchorIn(
  node: MermaidLayoutNode,
  direction: MermaidDirection,
): MermaidPoint {
  switch (direction) {
    case "LR":
      return { x: node.x, y: node.y + node.height / 2 };
    case "RL":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "BT":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    default:
      return { x: node.x + node.width / 2, y: node.y };
  }
}

function routeEdge(
  start: MermaidPoint,
  end: MermaidPoint,
  direction: MermaidDirection,
): readonly MermaidPoint[] {
  const horizontalFlow = direction === "LR" || direction === "RL";
  if (horizontalFlow) {
    if (Math.abs(start.y - end.y) < 0.5) return [start, end];
    const midX = round2((start.x + end.x) / 2);
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (Math.abs(start.x - end.x) < 0.5) return [start, end];
  const midY = round2((start.y + end.y) / 2);
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function midpointOf(points: readonly MermaidPoint[]): MermaidPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const a = points[Math.floor((points.length - 1) / 2)];
  const b = points[Math.ceil((points.length - 1) / 2)];
  return { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2) };
}

/**
 * Place every node on a uniform grid: one axis is the LAYER (flow direction), the other is the
 * COLUMN (first-appearance order within the layer). Uniform cells are chosen over a tight packing on
 * purpose — the grid is what makes two renders of the same source byte-identical, and a bug-report
 * diagram is worth more as a stable, comparable artefact than as a pretty one.
 */
export function layoutMermaidDiagram(diagram: MermaidDiagram): MermaidLayout {
  const back = findBackEdges(diagram.nodes, diagram.edges);
  const layers = assignLayers(diagram.nodes, diagram.edges, back);

  const columnCursor = new Map<number, number>();
  const placements = diagram.nodes.map((node) => {
    const layer = layers.get(node.id) ?? 0;
    const column = columnCursor.get(layer) ?? 0;
    columnCursor.set(layer, column + 1);
    const drawnLabel = drawnLabelOf(node.label);
    return {
      node,
      layer,
      column,
      drawnLabel,
      width: nodeWidthOf(drawnLabel),
    };
  });

  const layerCount = placements.reduce(
    (max, p) => Math.max(max, p.layer + 1),
    1,
  );
  const columnCount = placements.reduce(
    (max, p) => Math.max(max, p.column + 1),
    1,
  );
  const cellAcross = placements.reduce(
    (max, p) => Math.max(max, p.width),
    MIN_NODE_WIDTH,
  );
  const horizontalFlow =
    diagram.direction === "LR" || diagram.direction === "RL";

  const alongExtent =
    layerCount * (horizontalFlow ? cellAcross : NODE_HEIGHT) +
    (layerCount - 1) * GAP_ALONG;
  const acrossExtent =
    columnCount * (horizontalFlow ? NODE_HEIGHT : cellAcross) +
    (columnCount - 1) * GAP_ACROSS;

  const width = MARGIN * 2 + (horizontalFlow ? alongExtent : acrossExtent);
  const height = MARGIN * 2 + (horizontalFlow ? acrossExtent : alongExtent);

  const nodes: MermaidLayoutNode[] = placements.map((placement) => {
    const alongIndex = placement.layer;
    const acrossIndex = placement.column;
    let x: number;
    let y: number;
    if (horizontalFlow) {
      x =
        MARGIN +
        alongIndex * (cellAcross + GAP_ALONG) +
        (cellAcross - placement.width) / 2;
      y = MARGIN + acrossIndex * (NODE_HEIGHT + GAP_ACROSS);
      if (diagram.direction === "RL") x = width - x - placement.width;
    } else {
      x =
        MARGIN +
        acrossIndex * (cellAcross + GAP_ACROSS) +
        (cellAcross - placement.width) / 2;
      y = MARGIN + alongIndex * (NODE_HEIGHT + GAP_ALONG);
      if (diagram.direction === "BT") y = height - y - NODE_HEIGHT;
    }
    return {
      id: placement.node.id,
      label: placement.node.label,
      drawnLabel: placement.drawnLabel,
      shape: placement.node.shape,
      layer: placement.layer,
      column: placement.column,
      x: round2(x),
      y: round2(y),
      width: round2(placement.width),
      height: NODE_HEIGHT,
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: MermaidLayoutEdge[] = diagram.edges.map((edge, index) => {
    const from = byId.get(edge.from)!;
    const to = byId.get(edge.to)!;
    const points = routeEdge(
      anchorOut(from, diagram.direction),
      anchorIn(to, diagram.direction),
      diagram.direction,
    ).map((point) => ({ x: round2(point.x), y: round2(point.y) }));
    return {
      from: edge.from,
      to: edge.to,
      label: edge.label,
      style: edge.style,
      arrow: edge.arrow,
      back: back.has(index),
      points,
      labelPoint: edge.label === null ? null : midpointOf(points),
    };
  });

  return deepFreeze({
    version: BUG_MERMAID_VERSION,
    direction: diagram.direction,
    width: round2(width),
    height: round2(height),
    nodes,
    edges,
  }) as MermaidLayout;
}

// ---------------------------------------------------------------------------------------------
// SVG element tree
//
// The output is a TREE, not a string, and the in-world surface maps it straight to React elements.
// That is the whole anti-injection design: a React renderer walking typed nodes has no HTML sink to
// exploit, so the escaping below is a second line of defence for the EXPORT path, not the only one.
// ---------------------------------------------------------------------------------------------

export type BugSvgTag =
  | "svg"
  | "g"
  | "rect"
  | "ellipse"
  | "polygon"
  | "polyline"
  | "line"
  | "text"
  | "title";

const ALLOWED_SVG_TAGS: ReadonlySet<string> = new Set<BugSvgTag>([
  "svg",
  "g",
  "rect",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "text",
  "title",
]);

/**
 * Note what is ABSENT: `style` (a CSS injection surface), `href`/`xlink:href` (fetches and navigates),
 * `class` (lets diagram text reach the host page's stylesheet), and every `on*` handler. Colours are
 * presentation attributes with values this module chooses, never values from the source.
 */
const ALLOWED_SVG_ATTRS: ReadonlySet<string> = new Set([
  "viewBox",
  "width",
  "height",
  "xmlns",
  "role",
  "aria-label",
  "x",
  "y",
  "rx",
  "ry",
  "cx",
  "cy",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "points",
  "x1",
  "y1",
  "x2",
  "y2",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "opacity",
]);

export interface BugSvgElement {
  readonly tag: BugSvgTag;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text: string | null;
  readonly children: readonly BugSvgElement[];
}

export interface MermaidTheme {
  readonly nodeFill: string;
  readonly nodeStroke: string;
  readonly text: string;
  readonly edge: string;
  readonly edgeLabelFill: string;
  readonly fontFamily: string;
}

export const DEFAULT_MERMAID_THEME: MermaidTheme = Object.freeze({
  nodeFill: "#16202b",
  nodeStroke: "#4d7fa8",
  text: "#e6eef5",
  edge: "#7fa8c4",
  edgeLabelFill: "#0d151d",
  // A local stack only. A webfont would be an external fetch, which is the thing this slice forbids.
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

function el(
  tag: BugSvgTag,
  attrs: Record<string, string | number>,
  children: readonly BugSvgElement[] = [],
  text: string | null = null,
): BugSvgElement {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) flat[key] = String(value);
  return { tag, attrs: flat, text, children };
}

function shapeElement(
  node: MermaidLayoutNode,
  theme: MermaidTheme,
): BugSvgElement {
  const common = {
    fill: theme.nodeFill,
    stroke: theme.nodeStroke,
    "stroke-width": 1.5,
  };
  switch (node.shape) {
    case "circle":
      return el("ellipse", {
        cx: round2(node.x + node.width / 2),
        cy: round2(node.y + node.height / 2),
        rx: round2(node.width / 2),
        ry: round2(node.height / 2),
        ...common,
      });
    case "stadium":
      return el("rect", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rx: round2(node.height / 2),
        ry: round2(node.height / 2),
        ...common,
      });
    case "round":
      return el("rect", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rx: 10,
        ry: 10,
        ...common,
      });
    case "diamond": {
      const cx = round2(node.x + node.width / 2);
      const cy = round2(node.y + node.height / 2);
      const points = [
        `${cx},${node.y}`,
        `${round2(node.x + node.width)},${cy}`,
        `${cx},${round2(node.y + node.height)}`,
        `${node.x},${cy}`,
      ].join(" ");
      return el("polygon", { points, ...common });
    }
    default:
      return el("rect", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rx: 3,
        ry: 3,
        ...common,
      });
  }
}

/** Derived from the last segment; see property 4 in the header for why this is not an SVG `<marker>`. */
function arrowHead(
  points: readonly MermaidPoint[],
  theme: MermaidTheme,
): BugSvgElement | null {
  if (points.length < 2) return null;
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = tip.x - prev.x;
  const dy = tip.y - prev.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uy = dy / length;
  const head = 9;
  const half = 4.5;
  const baseX = tip.x - ux * head;
  const baseY = tip.y - uy * head;
  const shape = [
    `${round2(tip.x)},${round2(tip.y)}`,
    `${round2(baseX - uy * half)},${round2(baseY + ux * half)}`,
    `${round2(baseX + uy * half)},${round2(baseY - ux * half)}`,
  ].join(" ");
  return el("polygon", { points: shape, fill: theme.edge, stroke: "none" });
}

function dashFor(style: MermaidEdgeStyle): string | null {
  return style === "dotted" ? "5 4" : null;
}

function widthFor(style: MermaidEdgeStyle): number {
  return style === "thick" ? 3 : 1.5;
}

/**
 * Build the element tree for a laid-out diagram. `label` values are the only reporter-controlled data
 * in the output and they appear ONLY as `text` on a `text`/`title` element — never as an attribute,
 * never as a tag name.
 */
export function mermaidSvgElements(
  layout: MermaidLayout,
  theme: MermaidTheme = DEFAULT_MERMAID_THEME,
): BugSvgElement {
  const edgeElements: BugSvgElement[] = [];
  for (const edge of layout.edges) {
    const dash = dashFor(edge.style);
    edgeElements.push(
      el("polyline", {
        points: edge.points.map((p) => `${p.x},${p.y}`).join(" "),
        fill: "none",
        stroke: theme.edge,
        "stroke-width": widthFor(edge.style),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...(dash ? { "stroke-dasharray": dash } : {}),
        ...(edge.back ? { opacity: "0.75" } : {}),
      }),
    );
    if (edge.arrow) {
      const head = arrowHead(edge.points, theme);
      if (head) edgeElements.push(head);
    }
    if (edge.label !== null && edge.labelPoint) {
      const halfWidth = round2(
        (Math.min(edge.label.length, MAX_DRAWN_LABEL_CHARS) * 6.4 + 10) / 2,
      );
      edgeElements.push(
        el("rect", {
          x: round2(edge.labelPoint.x - halfWidth),
          y: round2(edge.labelPoint.y - 9),
          width: round2(halfWidth * 2),
          height: 18,
          rx: 3,
          ry: 3,
          fill: theme.edgeLabelFill,
          stroke: "none",
        }),
      );
      edgeElements.push(
        el(
          "text",
          {
            x: edge.labelPoint.x,
            y: edge.labelPoint.y,
            fill: theme.text,
            "font-family": theme.fontFamily,
            "font-size": 11,
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          },
          [],
          drawnLabelOf(edge.label),
        ),
      );
    }
  }

  const nodeElements: BugSvgElement[] = [];
  for (const node of layout.nodes) {
    const children: BugSvgElement[] = [shapeElement(node, theme)];
    if (node.drawnLabel !== node.label)
      children.push(el("title", {}, [], node.label));
    children.push(
      el(
        "text",
        {
          x: round2(node.x + node.width / 2),
          y: round2(node.y + node.height / 2),
          fill: theme.text,
          "font-family": theme.fontFamily,
          "font-size": 12,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
        },
        [],
        node.drawnLabel,
      ),
    );
    nodeElements.push(el("g", {}, children));
  }

  return deepFreeze(
    el(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        width: layout.width,
        height: layout.height,
        role: "img",
      },
      [el("g", {}, edgeElements), el("g", {}, nodeElements)],
    ),
  ) as BugSvgElement;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeSvgAttr(value: string): string {
  return escapeSvgText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Serialize the tree for the EXPORT path (a written report, a PR comment, a stored artefact). The tag
 * and attribute allowlists are re-checked here rather than trusted from the builder: this function is
 * the boundary where structure becomes text, so it is the only place a check is worth anything.
 */
export function bugSvgToMarkup(element: BugSvgElement): string {
  if (!ALLOWED_SVG_TAGS.has(element.tag))
    throw new BugMermaidError(
      "INVALID_SVG",
      `tag '${element.tag}' is not allowlisted`,
    );
  const attrs: string[] = [];
  for (const [name, value] of Object.entries(element.attrs)) {
    if (!ALLOWED_SVG_ATTRS.has(name))
      throw new BugMermaidError(
        "INVALID_SVG",
        `attribute '${name}' is not allowlisted`,
      );
    attrs.push(`${name}="${escapeSvgAttr(String(value))}"`);
  }
  const open =
    attrs.length > 0 ? `<${element.tag} ${attrs.join(" ")}` : `<${element.tag}`;
  const inner =
    (element.text === null ? "" : escapeSvgText(element.text)) +
    element.children.map(bugSvgToMarkup).join("");
  if (inner === "") return `${open}/>`;
  return `${open}>${inner}</${element.tag}>`;
}

export interface RenderedMermaid {
  readonly diagram: MermaidDiagram;
  readonly layout: MermaidLayout;
  readonly svg: BugSvgElement;
}

/** Source → drawable tree, with no step in between that touches the network or the DOM. */
export function renderMermaidLocally(
  source: string,
  theme: MermaidTheme = DEFAULT_MERMAID_THEME,
): RenderedMermaid {
  const diagram = parseMermaidDiagram(source);
  const layout = layoutMermaidDiagram(diagram);
  return Object.freeze({
    diagram,
    layout,
    svg: mermaidSvgElements(layout, theme),
  });
}
