// Spec 077 P3 — the HOUSE BUILDER: a visual floor-plan editor + live 3D brick preview, a thin React
// shell over the SAME shared cores the game uses (blueprintScript parse/serialise/validate,
// houseBuilder compile, voxelMesh greedy mesher) so what you see here is exactly the house the game
// raises. Every control carries a data-build-action selector so a Playwright-driven Hermes bot can
// click the same grammar a human does (P6). Opened as /builder.html?citizenId=..&lotId=..&w=..&d=..
// &seed=..[&bp=<encoded script>]; Accept validates and posts {type:'blueprint_saved', citizenId,
// lotId, script} back to the opener (P4 stores it and raises the house).
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  parseBlueprint,
  blueprintToScript,
  validateBlueprint,
  ROOM_KINDS,
  type ParsedBlueprint,
  type RoomKind,
} from "../blueprintScript";
import { compileBlueprint, VOXEL_Y } from "../houseBuilder";
import { greedyMesh } from "../render/voxelMesh";
import {
  defaultDesign,
  addRoom,
  removeRoom,
  moveRoom,
  resizeRoom,
  toggleWin,
  setRoomKind,
  cycleDoor,
  setWallH,
  addItem,
  removeItem,
  moveItem,
  rotateItem,
} from "./blueprintEdit";
import { FURNITURE_CATALOG, FURNITURE_KINDS } from "../furniture";
import { BuilderDesk } from "./BuilderDesk";

const ROOM_COLOR: Record<RoomKind, string> = {
  living: "#caa86a",
  bedroom: "#8fb0d8",
  garage: "#9a958c",
  patio: "#c2b59b",
  pool: "#3f7fb0",
};

interface Params {
  citizenId: string;
  lotId: string;
  w: number;
  d: number;
  seed: number;
  bp: string | null;
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const num = (k: string, dflt: number) => {
    const n = Number(q.get(k));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
  };
  return {
    citizenId: q.get("citizenId") ?? "citizen_dev",
    lotId: q.get("lotId") ?? "lot_dev",
    w: num("w", 19), // 084 S6 — the ESTATE house zone is the new default canvas
    d: num("d", 14),
    seed: num("seed", 0x1234abcd),
    bp: q.get("bp"),
  };
}

/** The live 3D preview: compiles the design and greedy-meshes it into one BufferGeometry, exactly the
 *  game's render path. Rebuilt on every design change; the scene + camera persist across rebuilds. */
function Preview({
  design,
  w,
  d,
  seed,
}: {
  design: ParsedBlueprint;
  w: number;
  d: number;
  seed: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    mesh: THREE.Mesh | null;
    renderer: THREE.WebGLRenderer;
    mat: THREE.Material;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const W = host.clientWidth || 520;
    const H = host.clientHeight || 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1022);
    const cam = new THREE.PerspectiveCamera(46, W / H, 0.1, 200);
    // Frame the WHOLE house + yard on first load whatever the pane size — back off with the larger
    // plot dimension so nothing is cropped; the user can still orbit/zoom from there.
    const span = Math.max(w, d);
    cam.position.set(w * 1.15, span * 1.05, d / 2 + span * 1.9);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(w / 2, 0.8, d / 2);
    controls.update();
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3344, 1.35));
    const sun = new THREE.DirectionalLight(0xffe8c0, 1.6);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(w + 4, 0.1, d + 4),
      new THREE.MeshStandardMaterial({ color: 0x46603a, roughness: 1 }),
    );
    ground.position.set(w / 2, -0.06, d / 2);
    scene.add(ground);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.75,
      metalness: 0.04,
    });
    const state = { scene, mesh: null as THREE.Mesh | null, renderer, mat };
    sceneRef.current = state;
    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [w, d]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    if (st.mesh) {
      st.scene.remove(st.mesh);
      st.mesh.geometry.dispose();
      st.mesh = null;
    }
    try {
      const compiled = compileBlueprint(blueprintToScript(design), {
        w,
        d,
        seed,
      });
      const { geometry } = greedyMesh(compiled.blocks, {
        n: compiled.n,
        cell: 1,
        voxelY: VOXEL_Y,
      });
      const mesh = new THREE.Mesh(geometry, st.mat);
      st.scene.add(mesh);
      st.mesh = mesh;
    } catch {
      // an invalid mid-edit design simply previews nothing; the validation panel says why
    }
  }, [design, w, d, seed]);

  return (
    <div
      ref={hostRef}
      data-build-area="preview-3d"
      style={{ width: "100%", height: "100%", minHeight: 420 }}
    />
  );
}

export function BuilderApp() {
  const params = useMemo(readParams, []);
  const [design, setDesign] = useState<ParsedBlueprint>(() => {
    if (params.bp) {
      try {
        return parseBlueprint(decodeURIComponent(params.bp));
      } catch {
        /* fall through to the starter design */
      }
    }
    return defaultDesign(params.w, params.d);
  });
  const [sel, setSel] = useState(0);
  // The selection is ALSO held in a ref so a synchronous burst of clicks (a batching bot) always edits
  // the room selected by the latest click, not the one from the last completed render.
  const selRef = useRef(0);
  const select = (i: number) => {
    selRef.current = i;
    setSel(i);
  };
  // Furniture (spec 088) has its own selection, parallel to the room selection. -1 = nothing selected.
  const [selItem, setSelItem] = useState(-1);
  const selItemRef = useRef(-1);
  const selectItem = (i: number) => {
    selItemRef.current = i;
    setSelItem(i);
  };
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const script = blueprintToScript(design);
  const validation = validateBlueprint(script);
  const selRoom = design.rooms[sel];
  const selItemObj = design.items[selItem];

  /** Apply an edit as a FUNCTIONAL update so rapid clicks (a Playwright bot, a held key) each operate
   *  on the latest design instead of a stale render closure — without this, N fast clicks collapse to 1.
   *  Selection is kept in selRef in the same pass so burst edits always target the latest room. */
  const apply = (
    op: (p: ParsedBlueprint) => ParsedBlueprint,
    selectLast = false,
  ) => {
    setDesign((prev) => {
      const next = op(prev);
      const ns = selectLast
        ? next.rooms.length - 1
        : Math.min(selRef.current, Math.max(0, next.rooms.length - 1));
      selRef.current = ns;
      setSel(ns);
      return next;
    });
    setSavedAt(null);
  };

  /** Apply a FURNITURE edit, keeping the item selection on the latest design (same burst-safe pattern as
   *  apply). selectLast points at the freshly added piece; otherwise the selection clamps into range. */
  const applyItem = (
    op: (p: ParsedBlueprint) => ParsedBlueprint,
    selectLast = false,
  ) => {
    setDesign((prev) => {
      const next = op(prev);
      const ns = selectLast
        ? next.items.length - 1
        : Math.min(selItemRef.current, next.items.length - 1);
      selItemRef.current = ns;
      setSelItem(ns);
      return next;
    });
    setSavedAt(null);
  };

  const accept = () => {
    if (!validation.ok) return;
    const msg = {
      type: "blueprint_saved",
      citizenId: params.citizenId,
      lotId: params.lotId,
      script,
    };
    if (window.opener)
      (window.opener as Window).postMessage(msg, window.location.origin);
    window.parent?.postMessage(msg, window.location.origin);
    setSavedAt(script);
  };

  // Spec 083 P2 — the Builder Desk hands its agreed brief here as a ready blueprint: load it as the
  // editable design so the player can tweak it and Accept through the same validated path.
  const loadNegotiated = (negotiatedScript: string) => {
    try {
      apply(() => parseBlueprint(negotiatedScript), false);
      select(0);
    } catch {
      /* an engine bug would throw in briefToBlueprint already; ignore a stray parse here */
    }
  };

  // 2D plan geometry: one SVG cell per plot cell. The cell size adapts so a big estate footprint
  // still fits the popup (spec 084 S4): clamp(640 / span, 16, 34).
  const CELL = Math.max(
    16,
    Math.min(34, Math.floor(640 / Math.max(design.w, design.d))),
  );
  const planW = design.w * CELL;
  const planH = design.d * CELL;
  // Live voxel-budget readout — the same enforced budget compileBlueprint throws past, surfaced
  // BEFORE Accept so a bot (or human) sees the cost of a design as it grows.
  const voxels = useMemo(() => {
    try {
      return compileBlueprint(blueprintToScript(design), {
        w: design.w,
        d: design.d,
        seed: params.seed,
      }).blocks.length;
    } catch {
      return -1; // over budget or uncompilable — the header shows the warning
    }
  }, [design, params.seed]);

  const btn: React.CSSProperties = {
    padding: "3px 9px",
    fontSize: 12,
    background: "#1c2433",
    color: "#dfe7f2",
    border: "1px solid #34415a",
    borderRadius: 4,
    cursor: "pointer",
  };
  const panel: React.CSSProperties = {
    background: "#10141f",
    border: "1px solid #232c3f",
    borderRadius: 8,
    padding: 12,
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: 14,
        height: "100vh",
        boxSizing: "border-box",
        background: "#0a0d14",
        color: "#dfe7f2",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      {/* left — the 2D floor plan */}
      <div
        style={{ ...panel, display: "flex", flexDirection: "column", gap: 8 }}
      >
        <b data-build-area="budget">
          Floor plan · {design.w}×{design.d} cells · door{" "}
          {design.doorDir.toUpperCase()} · {design.wallH} storey
          {design.wallH > 1 ? "s" : ""} ·{" "}
          {voxels >= 0 ? (
            `${voxels.toLocaleString()} voxels`
          ) : (
            <span style={{ color: "#e0584d" }}>
              over the voxel budget — shrink the design
            </span>
          )}
        </b>
        <svg
          data-build-area="plan-2d"
          width={planW + 2}
          height={planH + 2}
          style={{
            background: "#0d1119",
            border: "1px solid #232c3f",
            borderRadius: 4,
          }}
        >
          {/* grid */}
          {Array.from({ length: design.w + 1 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={i * CELL + 1}
              y1={1}
              x2={i * CELL + 1}
              y2={planH + 1}
              stroke="#1b2331"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: design.d + 1 }, (_, i) => (
            <line
              key={`h${i}`}
              x1={1}
              y1={i * CELL + 1}
              x2={planW + 1}
              y2={i * CELL + 1}
              stroke="#1b2331"
              strokeWidth={1}
            />
          ))}
          {/* rooms */}
          {design.rooms.map((r, i) => (
            <g
              key={i}
              data-build-action={`select-room-${i}`}
              onClick={() => select(i)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={r.x * CELL + 2}
                y={r.y * CELL + 2}
                width={r.w * CELL - 2}
                height={r.d * CELL - 2}
                fill={ROOM_COLOR[r.kind]}
                fillOpacity={i === sel ? 0.85 : 0.45}
                stroke={i === sel ? "#ffd76a" : "#46506a"}
                strokeWidth={i === sel ? 2.5 : 1}
                rx={3}
              />
              <text
                x={r.x * CELL + 7}
                y={r.y * CELL + 17}
                fontSize={11}
                fill="#0d1119"
                fontWeight={700}
              >
                {r.kind}
                {r.win ? " ⊞" : ""}
              </text>
            </g>
          ))}
          {/* door marker on the house edge */}
          {(() => {
            const mid = {
              n: [planW / 2, 3],
              s: [planW / 2, planH - 1],
              w: [3, planH / 2],
              e: [planW - 1, planH / 2],
            }[design.doorDir];
            return (
              <circle
                cx={mid[0]! + 1}
                cy={mid[1]! + 1}
                r={5}
                fill="#5a3a22"
                stroke="#ffd76a"
                strokeWidth={2}
              />
            );
          })()}
          {/* furniture markers (spec 088): a glyph at the cell each piece sits in, click to select */}
          {design.items.map((f, i) => {
            const cx = f.x * CELL + CELL / 2 + 1;
            const cy = f.y * CELL + CELL / 2 + 1;
            return (
              <g
                key={`item-${i}`}
                data-build-action={`select-item-${i}`}
                onClick={() => selectItem(i)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={CELL * 0.36}
                  fill="#0d1119"
                  fillOpacity={0.85}
                  stroke={i === selItem ? "#ffd76a" : "#9fd0a0"}
                  strokeWidth={i === selItem ? 2.5 : 1.25}
                />
                <text
                  x={cx}
                  y={cy + CELL * 0.16}
                  fontSize={CELL * 0.42}
                  textAnchor="middle"
                >
                  {FURNITURE_CATALOG[f.kind].icon}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            data-build-action="door-cycle"
            style={btn}
            onClick={() => apply(cycleDoor)}
          >
            Door: {design.doorDir.toUpperCase()} ↻
          </button>
          <button
            data-build-action="wall-down"
            style={btn}
            onClick={() => apply((p) => setWallH(p, p.wallH - 1))}
          >
            − storey
          </button>
          <button
            data-build-action="wall-up"
            style={btn}
            onClick={() => apply((p) => setWallH(p, p.wallH + 1))}
          >
            + storey
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ opacity: 0.7 }}>Add room:</span>
          {ROOM_KINDS.map((k) => (
            <button
              key={k}
              data-build-action={`add-room-${k}`}
              style={{ ...btn, borderColor: ROOM_COLOR[k] }}
              onClick={() => apply((p) => addRoom(p, k), true)}
            >
              {k}
            </button>
          ))}
        </div>
        {selRoom && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ opacity: 0.7 }}>
              Room {sel} ({selRoom.kind}):
            </span>
            <button
              data-build-action="move-left"
              style={btn}
              onClick={() => apply((p) => moveRoom(p, selRef.current, -1, 0))}
            >
              ←
            </button>
            <button
              data-build-action="move-right"
              style={btn}
              onClick={() => apply((p) => moveRoom(p, selRef.current, 1, 0))}
            >
              →
            </button>
            <button
              data-build-action="move-up"
              style={btn}
              onClick={() => apply((p) => moveRoom(p, selRef.current, 0, -1))}
            >
              ↑
            </button>
            <button
              data-build-action="move-down"
              style={btn}
              onClick={() => apply((p) => moveRoom(p, selRef.current, 0, 1))}
            >
              ↓
            </button>
            <button
              data-build-action="grow-w"
              style={btn}
              onClick={() => apply((p) => resizeRoom(p, selRef.current, 1, 0))}
            >
              w+
            </button>
            <button
              data-build-action="shrink-w"
              style={btn}
              onClick={() => apply((p) => resizeRoom(p, selRef.current, -1, 0))}
            >
              w−
            </button>
            <button
              data-build-action="grow-d"
              style={btn}
              onClick={() => apply((p) => resizeRoom(p, selRef.current, 0, 1))}
            >
              d+
            </button>
            <button
              data-build-action="shrink-d"
              style={btn}
              onClick={() => apply((p) => resizeRoom(p, selRef.current, 0, -1))}
            >
              d−
            </button>
            <button
              data-build-action="toggle-win"
              style={btn}
              onClick={() => apply((p) => toggleWin(p, selRef.current))}
            >
              {selRoom.win ? "win off" : "win on"}
            </button>
            <select
              data-build-action="room-kind"
              value={selRoom.kind}
              onChange={(e) => {
                const k = e.target.value as RoomKind;
                apply((p) => setRoomKind(p, selRef.current, k));
              }}
              style={{ ...btn, padding: "2px 6px" }}
            >
              {ROOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button
              data-build-action="delete-room"
              style={{ ...btn, color: "#e0584d" }}
              onClick={() => apply((p) => removeRoom(p, selRef.current))}
            >
              delete
            </button>
          </div>
        )}
        {/* furniture palette (spec 088) — place interior pieces; the 3D preview meshes them live */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
            borderTop: "1px solid #232c3f",
            paddingTop: 8,
          }}
        >
          <span style={{ opacity: 0.7 }}>Furniture:</span>
          {FURNITURE_KINDS.map((k) => (
            <button
              key={k}
              data-build-action={`add-item-${k}`}
              title={FURNITURE_CATALOG[k].label}
              style={{ ...btn, borderColor: "#3a6a4a" }}
              onClick={() => applyItem((p) => addItem(p, k), true)}
            >
              {FURNITURE_CATALOG[k].icon} {FURNITURE_CATALOG[k].label}
            </button>
          ))}
        </div>
        {selItemObj && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ opacity: 0.7 }}>
              {FURNITURE_CATALOG[selItemObj.kind].icon} {selItemObj.kind} (cell{" "}
              {selItemObj.x},{selItemObj.y}):
            </span>
            <button
              data-build-action="move-item-left"
              style={btn}
              onClick={() => applyItem((p) => moveItem(p, selItemRef.current, -1, 0))}
            >
              ←
            </button>
            <button
              data-build-action="move-item-right"
              style={btn}
              onClick={() => applyItem((p) => moveItem(p, selItemRef.current, 1, 0))}
            >
              →
            </button>
            <button
              data-build-action="move-item-up"
              style={btn}
              onClick={() => applyItem((p) => moveItem(p, selItemRef.current, 0, -1))}
            >
              ↑
            </button>
            <button
              data-build-action="move-item-down"
              style={btn}
              onClick={() => applyItem((p) => moveItem(p, selItemRef.current, 0, 1))}
            >
              ↓
            </button>
            <button
              data-build-action="rotate-item"
              style={btn}
              onClick={() => applyItem((p) => rotateItem(p, selItemRef.current))}
            >
              rotate ↻ ({selItemObj.rot * 90}°)
            </button>
            <button
              data-build-action="delete-item"
              style={{ ...btn, color: "#e0584d" }}
              onClick={() => applyItem((p) => removeItem(p, selItemRef.current))}
            >
              delete
            </button>
          </div>
        )}
        {/* validation + the script itself */}
        <div
          data-build-area="validation"
          style={{ fontSize: 12, color: validation.ok ? "#9fd0a0" : "#e0a06a" }}
        >
          {validation.ok
            ? `✓ valid · est. materials ${validation.estMaterials}`
            : validation.errors.map((e, i) => <div key={i}>✗ {e}</div>)}
        </div>
        <textarea
          data-build-area="script"
          readOnly
          value={script}
          rows={3}
          style={{
            background: "#0d1119",
            color: "#9fb6d8",
            border: "1px solid #232c3f",
            borderRadius: 4,
            fontFamily: "monospace",
            fontSize: 11,
            padding: 6,
            resize: "none",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            data-build-action="accept"
            disabled={!validation.ok}
            style={{
              ...btn,
              padding: "6px 18px",
              fontWeight: 700,
              background: validation.ok ? "#2c5a35" : "#222",
              borderColor: validation.ok ? "#3f8a4d" : "#333",
              cursor: validation.ok ? "pointer" : "not-allowed",
            }}
            onClick={accept}
          >
            Accept · build this house
          </button>
          {savedAt === script && (
            <span
              data-build-area="saved"
              style={{ color: "#9fd0a0", fontSize: 12 }}
            >
              ✓ blueprint saved
            </span>
          )}
        </div>
        <div style={{ opacity: 0.55, fontSize: 11 }}>
          for {params.citizenId} · {params.lotId} · plot {params.w}×{params.d} ·
          seed {params.seed}
        </div>
      </div>
      {/* middle — Viw's Builder Desk: dream → haggle → blueprint (spec 083 P2) */}
      <BuilderDesk
        seed={params.seed}
        zoneW={params.w}
        zoneD={params.d}
        onAccept={loadNegotiated}
      />
      {/* right — the live 3D brick preview */}
      <div
        style={{
          ...panel,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <b>Live preview — exactly what the game will build</b>
        <div style={{ flex: 1 }}>
          <Preview
            design={design}
            w={params.w}
            d={params.d}
            seed={params.seed}
          />
        </div>
      </div>
    </div>
  );
}
