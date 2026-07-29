# Spec 161 — Composing the bug report: Markdown, local Mermaid, and the assisted repro chatbox (BUG.COMPOSE.1)

- **Status:** proposed for review. The composition model, the local renderers and the evidence seam
  ship here; no in-world surface is mounted yet — `projectBugComposeView` is the seam for it.
- **Depends on:** spec 160 (in-world bug capture — **merged**, PR #415) for the `captureId`, world,
  sol and viewport a report binds to; spec 159 (on-screen marking — PR #419, still open) for the
  annotation layer. Both are declared STRUCTURALLY here, so this slice reviews and merges on its own.
- **Relates to:** spec 152 (authoritative spatial registry, the presence address a capture carries),
  BUG.GEO.1 (`presenceReadout.ts`, merged as #414),
  `bridge/from-claude-citylife/2026-07-23-in-world-bug-reporting-and-kco-bounty.md` — items 3 and 4 of
  the operator's decomposition.
- **Out of scope, deliberately:** the bug record's lifecycle and its wiring to the Task API
  (BUG.TRACK.1), any KCO reward (BUG.KCO.1 — reward on VALIDATED fix only, through the existing
  authenticated score authority), and the mounted compose panel, which lands with the rest of the
  in-world bug chrome once capture, annotation and composition all exist.

## 1. Why

Spec 160 made the VIEW reproducible. Spec 159 made the ARROW survive. Neither of them says what is
wrong, and a report that carries a perfect camera pose and a red arrow but a body reading "broken"
still costs a reviewer an hour to triage.

Two things are needed. A body rich enough to be worth writing — Markdown, and Mermaid for the state
machines and flows a reporter reaches for when describing a sequence. And something that gets the
reporter to write the parts they habitually skip: the steps somebody else can follow, and EXPECTED
versus ACTUAL as two different sentences.

There is also a deadline on getting this right. BUG.KCO.1 will pay a bounty against these records, at
which point "someone typing a bug report" becomes "someone with a financial reason to file many of
them, whose text is rendered inside a reviewer's authenticated session".

## 2. What ships

Three pure, framework-agnostic modules — no DOM, no React, no three.js, no network — each returning
new deep-frozen values and mutating nothing:

- **`src/colony/bug/bugMermaid.ts`** — a local Mermaid flowchart implementation: parse → layer and
  lay out → an SVG ELEMENT TREE. `bugSvgToMarkup` serializes that tree for export.
- **`src/colony/bug/bugMarkdown.ts`** — the body: source → a typed block/inline tree, with the link
  policy, the fetch policy, and ```mermaid fences resolved at parse time. `bugMarkdownToHtml` is the
  export path; `collectBugDocumentFetchTargets` is the executable form of the no-fetch claim.
- **`src/colony/bug/bugCompose.ts`** — the draft, the prompt catalogue, readiness, the evidence
  binding, the committed `BugReportBody` with its self-verifying id and JSON transport, the canonical
  tracker Markdown, and `projectBugComposeView` for a surface to render.

## 3. Render strictly locally — what that actually forbids

The task says "no external fetch, no CDN". Taken seriously that rules out four things, not one.

**No `mermaid` from a CDN, and no `mermaid` at all.** Upstream renders through `innerHTML` and has
carried XSS advisories; a bug body is untrusted text, so handing it to a renderer with an HTML sink is
the shape of the vulnerability rather than a mitigation of it. A CDN tag would additionally make every
reviewer who opens a report contact a third party, and would let a version bump silently change what a
filed report looks like years later. The supported subset is implemented here instead.

**No web font.** `font-family` is a local stack. A webfont is an external fetch wearing a stylesheet.

**No inline images.** There is deliberately no image node type in the Markdown model. `![](url)` makes
a reviewer's client hit a reporter-chosen host the moment the report is OPENED — a beacon that leaks
their IP and the time they read it, and a way to move a payload past a CSP that allows images.
Evidence images travel as spec-160 capture records. A refused image is not silently dropped: the alt
text stays, the URL is recorded in `document.rejectedImages`, and the composer surfaces it as a
warning.

**No `%%{init}%%`.** Upstream Mermaid lets that directive set `securityLevel` and inject theme CSS
from inside the diagram source — the untrusted body switching off the thing protecting the reviewer.
It is rejected with a line number rather than ignored, because a diagram that renders as something
other than what was typed is worse than one that does not render.

## 4. The rendering surface is closed by construction, not by escaping

The primary defence is that **there is no HTML sink**. `renderBugMarkdown` produces a typed tree and
`mermaidSvgElements` produces a typed element tree; the in-world surface maps those to React
elements, which escape by construction, so `dangerouslySetInnerHTML` never appears. Escaping matters
only on the EXPORT path (`bugMarkdownToHtml`, `bugSvgToMarkup`), where structure becomes a string —
and that is the one place the tag and attribute allowlists are enforced, because it is the only place
a check is worth anything.

Note what is absent from the SVG attribute allowlist: `style` (a CSS injection surface), `class` (lets
diagram text reach the host page's stylesheet), `href`/`xlink:href` (fetches and navigates), and every
`on*` handler. Colours are presentation attributes whose values this module chooses.

### Link schemes are allowlisted, and the check is on the whole URL

`https`, `http`, `mailto` and the in-world `citylife` scheme are allowed; everything else is refused
and rendered as text with the raw URL kept visible in a code span.

The load-bearing part is that **any character at or below U+0020 anywhere in the URL is a refusal**.
Browsers strip tabs and newlines out of a URL before resolving its scheme, so `java\tscript:alert(1)`
is a working `javascript:` URL that a naive `split(":")[0]` reads as the harmless scheme `java`. A
denylist (`/^javascript:/i`) is the implementation everyone writes first and it is the one that fails
here — verified, in §7. Whitespace inside a URL is never meaningful in a bug report, so the safe rule
is also the correct one.

### BIDI overrides are stripped before anything is parsed

U+202E and its relatives make a line RENDER in a different order than it PARSES — the "Trojan Source"
trick. In source code that is a supply-chain problem; in a bug report it means an EXPECTED line can be
made to display as its own opposite to the reviewer deciding whether to pay a bounty on it.

## 5. Mermaid: the three decisions worth writing down

**A cycle must not hang the layout.** `A --> B --> C --> A` is a normal thing for a reporter to draw
(a retry loop), and longest-path layering written the natural recursive way never terminates on it.
Cycle detection is an ITERATIVE depth-first walk in declaration order; back edges are excluded from
LAYERING but are still DRAWN, and the same source always classifies the same edge as the back edge.

**The arrow head is a derived polygon, never an SVG `<marker>`.** Marker ids are DOCUMENT-global. Two
diagrams in one bug body would collide, and the second one's arrows would silently inherit the first
one's geometry. Deriving the head from the last segment removes ids from the output entirely — the
same reasoning spec 159 applies to its own arrow barbs.

**Layout is a uniform grid.** A tighter packing would look better; a grid makes two renders of the
same source byte-identical. A bug-report diagram is worth more as a stable, comparable artefact than
as a pretty one, and determinism is what lets a content-addressed store or a "has this changed?" check
work at all.

Everything outside the supported subset (`flowchart`/`graph` with a direction, five node shapes, four
edge styles, edge labels, chains) fails with a line number, and named diagram kinds like
`sequenceDiagram` say so by name. A diagram that fails degrades to a code block plus a diagnostic — it
never rejects the reporter's whole report, because losing a page of repro steps to a typo'd arrow is
not a trade anyone would take.

## 6. The assisted composer: what an assistant may and may not do

The chatbox is a deterministic local engine over a frozen catalogue of twelve prompts. No model, no
network, no randomness.

**It asks; it never writes.** Answers are stored as the reporter typed them — no rewriting, no
capitalisation, no "did you mean". The reporter is the one who has to defend the wording when a bounty
is disputed, so the wording stays theirs. The single-line fields additionally collapse runs of
whitespace, which is the only transformation performed on reporter text and the reason a field cannot
carry block structure into the canonical Markdown (§7).

**It never quotes the draft back.** Every question, rationale and example is a compile-time constant.
A composer that echoes the reporter's text — the obvious "helpful" implementation — reflects untrusted
content through the assistant's own voice to the next person who reads the transcript.

**Two checks BLOCK the commit, and they are the two that matter.** EXPECTED and ACTUAL must not
reduce to the same sentence, and neither may be a whole-string noise phrase ("broken", "doesn't work",
"n/a"). Both are matched on the WHOLE normalized string, never on a substring: "nothing happens when I
press E" is a good ACTUAL and must sail through, or reporters learn to fight the assistant instead of
using it. Everything else — a terse step, a missing capture, an unmarked capture — is advisory.

Blocking at commit is deliberate: a bounty will be paid against these records, and the cheapest place
to stop an unreproducible report is before it exists.

## 7. Attaching to the evidence, structurally

`BugComposeCaptureRef` is `{ captureId; world { worldId; seed }; sol { sol }; viewport { … } }` and
`BugComposeAnnotationRef` is `{ layerId; captureId; annotations[{ id; kind }] }`. A spec-160
`BugCaptureContext` and a spec-159 `BugAnnotationLayer` satisfy them as-is, with no shim and no
adapter. Spec 160 merged while this slice was in flight, so that claim is now CHECKED: the tests build
a genuine `BugCaptureContext` through the capture module's own API and hand it straight to
`attachBugEvidence`.

`attachBugEvidence` **refuses an annotation layer whose `captureId` is not the capture's.** Spec 159
already binds a layer to one capture, but a compose surface holds BOTH and can trivially hold the
wrong pair — the reporter re-captured after drawing, or reopened an older layer. Re-checking where the
two are joined is cheap, and the failure it prevents is invisible to every later reviewer: marks
presented over an image they were never drawn on.

### The committed report

`bodyId` is the FNV-1a construction spec 159 and spec 160 both use, so a reviewer learns the shape
once. It digests the SOURCE fields and **not** the rendered document: the document is a projection of
`bodyMarkdown`, and folding it in would change every historical id the day the renderer gains a
feature. For the same reason the wire form carries source only and re-derives the document on parse,
so a renderer improvement reaches every stored report instead of freezing at the version that filed
it. `parseBugReport` recomputes the id and rejects a mismatch.

### The canonical Markdown cannot be forged from inside a field

`renderBugReportMarkdown` emits `## Expected` and `## Actual`. A reporter whose ACTUAL begins with
`## Expected` would otherwise mint a second, contradictory section that reads as the tool's own.
Markdown block structure is decided at the START of a line, which is the complete set of positions
that matter — so each single-line field is emitted with a leading structural character escaped, and
that is also why fields are normalized to one line in the first place. The JSON transport, not the
Markdown, remains the source of truth.

## 8. Discrimination check — verified, not asserted

69 cases across `tests/bugMermaid.test.ts`, `tests/bugMarkdown.test.ts` and `tests/bugCompose.test.ts`
(72 after the spec-160 seam tests were added post-merge). **Eighteen naive implementations were
restored one at a time, the suite observed to FAIL, and the fix restored.** Full table in the PR body
and in `bridge/from-claude-citylife/2026-07-29-bug-compose-1-markdown-mermaid.md`. Headline results:

| Naive implementation restored | Result |
| --- | --- |
| Nothing is deep-frozen | 4 failed / 65 passed |
| HTML export does not escape | 3 failed / 66 passed |
| Link policy is a `javascript:` denylist | 2 failed / 67 passed |
| SVG text is not escaped | 2 failed / 67 passed |
| `bodyId` derived from the timestamp, not the contents | 2 failed / 67 passed |
| Prompts quote the reporter's own text back | 2 failed / 67 passed |
| A bad diagram rejects the whole report | 2 failed / 67 passed |
| Images render as links (no image refusal) | 2 failed / 67 passed |
| No cycle detection in the layout | 1 failed / 68 passed |
| Evidence binding (`captureId`) not checked | 1 failed / 68 passed |
| Canonical Markdown fields not escaped | 1 failed / 68 passed |
| `%%{init}%%` treated as an ordinary comment | 1 failed / 68 passed |
| Fix restored | **69 passed / 69** |

Two-sided coverage is deliberate throughout: the JSON round-trip asserts the EXACT key set so a field
can neither be lost nor gained; id stability is paired with sensitivity across fourteen single-field
mutations; every refusal test is paired with the matching acceptance (an allowed link renders, a
refused one degrades) so it cannot pass by refusing everything; and the noise check is paired with the
false-positive case it must not catch.

**One assertion is honestly weaker than it looks.** `collectBugDocumentFetchTargets(doc) === []` holds
by CONSTRUCTION — no node type carries a load-on-render URL — and it did not fail under any of the
eighteen naive implementations, including the one that renders images. It is documentation of the
invariant and a guard against a future node type introducing a fetch, not proof of today's behaviour.

## 9. Open questions

- **Where the report is stored, and its lifecycle.** This module produces and consumes one JSON
  string and takes no position. BUG.TRACK.1 decides.
- **The compose surface.** `projectBugComposeView` returns the prompt, the readiness lists, the parsed
  document and the warnings, so the panel is a 1:1 mapping with no logic worth a test. It mounts with
  the rest of the in-world bug chrome; which key opens it is that task's call.
- **Whether a missing capture should block rather than advise** once the capture UI is wired. It is
  advisory today because a report can legitimately be filed about something not on screen.
