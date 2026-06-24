// Spec 082 P1 — KOOKERBOOK, the site: a directory of every citizen and their profile page —
// portrait, address, a live 3D render of THEIR OWN designed house, and the timeline. Standalone:
// the page reads the same-origin kookerbook + blueprint stores directly (and overlays the backend
// when it answers), so it works without the game tab. Every control carries data-kb-action so a
// bot can drive it like the builder.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  loadKookerbookLocal,
  fetchKookerbookBackend,
  mergeKookerbook,
  type KbMap,
} from "../bot/kookerbookStore";
import { loadBlueprintsLocal } from "../bot/blueprintStore";
import { parseBlueprint } from "../blueprintScript";
import { compileBlueprint, VOXEL_Y } from "../houseBuilder";
import { greedyMesh } from "../render/voxelMesh";
import type { KbProfile, KbPost } from "./kookerbook";
import {
  kookerbookCanonicalProfileUrl,
  kookerbookDirectoryLink,
  kookerbookInitialSelection,
  kookerbookProfileUrl,
} from "./kookerbookNav";
import { kookerbookLayoutForViewport } from "./kookerbookLayout";

function houseScriptFor(citizenId: string): string | null {
  const map = loadBlueprintsLocal();
  for (const entry of Object.values(map))
    if (entry.citizenId === citizenId) return entry.script;
  return null;
}

/** A small static 3D render of the citizen's own designed house (their blueprint, their bricks). */
function HouseCard({
  script,
  style,
}: {
  script: string;
  style?: CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      const p = parseBlueprint(script);
      const seed = script
        .split("")
        .reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7);
      const compiled = compileBlueprint(script, { w: p.w, d: p.d, seed });
      const { geometry } = greedyMesh(compiled.blocks, {
        n: compiled.n,
        cell: 1,
        voxelY: VOXEL_Y,
      });
      const W = host.clientWidth || 360,
        H = 220;
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W, H);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.maxWidth = "100%";
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x101626);
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3344, 1.3));
      const sun = new THREE.DirectionalLight(0xffe8c0, 1.5);
      sun.position.set(6, 10, 5);
      scene.add(sun);
      const ground = new THREE.Mesh(
        new THREE.BoxGeometry(p.w + 3, 0.1, p.d + 3),
        new THREE.MeshStandardMaterial({ color: 0x46603a, roughness: 1 }),
      );
      ground.position.set(p.w / 2, -0.06, p.d / 2);
      scene.add(ground);
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.75,
      });
      scene.add(new THREE.Mesh(geometry, mat));
      const span = Math.max(p.w, p.d);
      const cam = new THREE.PerspectiveCamera(46, W / H, 0.1, 100);
      cam.position.set(p.w * 1.1, span * 0.95, p.d / 2 + span * 1.7);
      cam.lookAt(p.w / 2, 0.8, p.d / 2);
      renderer.render(scene, cam);
    } catch {
      /* an unparseable script simply shows no render */
    }
    return () => {
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentElement === host)
          host.removeChild(renderer.domElement);
      }
    };
  }, [script]);
  return (
    <div
      ref={hostRef}
      data-kb-area="house-render"
      style={{ borderRadius: 8, overflow: "hidden", ...style }}
    />
  );
}

function Portrait({ p, size = 44 }: { p: KbProfile; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: p.kind === "crab" ? "#7a2f1d" : "#2f4a6f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.55,
        flexShrink: 0,
      }}
    >
      {p.kind === "crab" ? "🦀" : "🙂"}
    </div>
  );
}

const KIND_LABEL: Record<KbPost["kind"], string> = {
  event: "📍",
  narration: "💭",
  authored: "✍️",
};

function viewportWidth(): number {
  return typeof window === "undefined" ? 1024 : window.innerWidth;
}

function App() {
  const [map, setMap] = useState<KbMap>(() => loadKookerbookLocal());
  const [layoutWidth, setLayoutWidth] = useState(() => viewportWidth());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setLayoutWidth(viewportWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Spec 090 — deep link: /kookerbook.html?citizen=<id> opens straight to that citizen (set when you
  // click their plot in the world). Falls back to the first profile if the id is not (yet) loaded.
  const [sel, setSel] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("citizen"),
  );
  useEffect(() => {
    void fetchKookerbookBackend().then((backend) => {
      if (backend) setMap((local) => mergeKookerbook(local, backend));
    });
  }, []);
  const profiles = useMemo(() => Object.values(map), [map]);
  const profileIds = useMemo(
    () => profiles.map((p) => p.citizenId),
    [profiles],
  );
  const initialSelection =
    typeof window === "undefined"
      ? null
      : kookerbookInitialSelection(window.location.href, profileIds);
  useEffect(() => {
    if (typeof window === "undefined" || profileIds.length === 0) return;
    const nextUrl = kookerbookCanonicalProfileUrl(
      window.location.href,
      profileIds,
    );
    if (nextUrl && nextUrl !== window.location.href)
      window.history.replaceState(null, "", nextUrl);
  }, [profileIds]);
  const selected =
    sel && map[sel]
      ? map[sel]
      : initialSelection
        ? map[initialSelection]
        : profiles[0];
  const houseScript = selected ? houseScriptFor(selected.citizenId) : null;
  const selectProfile = (citizenId: string) => {
    setSel(citizenId);
    if (typeof window === "undefined") return;
    const nextUrl = kookerbookProfileUrl(window.location.href, citizenId);
    if (nextUrl) window.history.replaceState(null, "", nextUrl);
  };

  const layout = kookerbookLayoutForViewport(layoutWidth);
  const panel: React.CSSProperties = {
    background: "#121826",
    border: "1px solid #232c3f",
    borderRadius: 10,
    padding: 14,
    boxSizing: "border-box",
    ...layout.panel,
  };
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.getElementById("root");
    const previousHtmlOverflowX = document.documentElement.style.overflowX;
    const previousBodyMargin = document.body.style.margin;
    const previousBodyOverflowX = document.body.style.overflowX;
    const previousRootWidth = root?.style.width ?? "";
    const previousRootMaxWidth = root?.style.maxWidth ?? "";
    const previousRootOverflowX = root?.style.overflowX ?? "";
    document.documentElement.style.overflowX = String(
      layout.document.html.overflowX ?? "",
    );
    document.body.style.margin = String(layout.document.body.margin ?? "");
    document.body.style.overflowX = String(
      layout.document.body.overflowX ?? "",
    );
    if (root) {
      root.style.width = String(layout.document.root.width ?? "");
      root.style.maxWidth = String(layout.document.root.maxWidth ?? "");
      root.style.overflowX = String(layout.document.root.overflowX ?? "");
    }
    return () => {
      document.documentElement.style.overflowX = previousHtmlOverflowX;
      document.body.style.margin = previousBodyMargin;
      document.body.style.overflowX = previousBodyOverflowX;
      if (root) {
        root.style.width = previousRootWidth;
        root.style.maxWidth = previousRootMaxWidth;
        root.style.overflowX = previousRootOverflowX;
      }
    };
  }, [
    layout.document.html.overflowX,
    layout.document.body.margin,
    layout.document.body.overflowX,
    layout.document.root.width,
    layout.document.root.maxWidth,
    layout.document.root.overflowX,
  ]);
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: 16,
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#0a0e18",
        color: "#dfe7f2",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        ...layout.shell,
      }}
    >
      {/* directory */}
      <div style={{ ...panel, ...layout.directory }}>
        <h2 style={{ margin: "2px 0 4px" }}>📘 Kookerbook</h2>
        <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 12 }}>
          the citizens of Landing One
        </div>
        {profiles.length === 0 && (
          <div style={{ opacity: 0.6 }}>
            No citizens yet — approve a newcomer in the colony, or visit after
            Joe moves in.
          </div>
        )}
        {profiles.map((p) => {
          const link =
            typeof window === "undefined"
              ? null
              : kookerbookDirectoryLink({
                  currentHref: window.location.href,
                  citizenId: p.citizenId,
                  alias: p.alias,
                  selectedCitizenId: selected?.citizenId ?? null,
                });
          return (
            <a
              key={p.citizenId}
              href={link?.href ?? "#"}
              aria-label={
                link?.ariaLabel ?? `Open Kookerbook profile for ${p.alias}`
              }
              aria-current={link?.ariaCurrent}
              data-kb-action={`select-profile-${p.citizenId}`}
              onClick={(event) => {
                event.preventDefault();
                selectProfile(p.citizenId);
              }}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: 8,
                borderRadius: 8,
                cursor: "pointer",
                background:
                  selected?.citizenId === p.citizenId
                    ? "#1c2740"
                    : "transparent",
                marginBottom: 4,
                color: "inherit",
                textDecoration: "none",
                ...layout.directoryLink,
              }}
            >
              <Portrait p={p} />
              <div style={layout.contentText}>
                <div style={{ fontWeight: 700 }}>{p.alias}</div>
                <div style={{ opacity: 0.65, fontSize: 12 }}>
                  {p.address ?? "no address yet"}
                </div>
                {p.posts[0] && (
                  <div
                    style={{
                      opacity: 0.5,
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.posts[0].text}
                  </div>
                )}
              </div>
            </a>
          );
        })}
      </div>
      {/* profile page */}
      {selected ? (
        <div
          style={{ ...panel, flex: 1, ...layout.profile }}
          data-kb-area="profile"
        >
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              marginBottom: 8,
              ...layout.profileHeader,
            }}
          >
            <Portrait p={selected} size={64} />
            <div style={layout.contentText}>
              <h2 style={{ margin: 0 }}>{selected.alias}</h2>
              <div style={{ opacity: 0.7 }}>
                {selected.address
                  ? `🏠 ${selected.address}`
                  : "looking for a home"}
                {selected.kind === "crab" ? " · Founder" : ""}
              </div>
            </div>
          </div>
          <p style={{ opacity: 0.85, marginTop: 4, ...layout.contentText }}>
            {selected.bio}
          </p>
          {houseScript && (
            <div style={{ margin: "10px 0" }}>
              <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 6 }}>
                their home — designed by them, rebuilt from their blueprint
              </div>
              <HouseCard script={houseScript} style={layout.houseRender} />
            </div>
          )}
          <h3 style={{ marginBottom: 6 }}>Timeline</h3>
          <div data-kb-area="timeline">
            {selected.posts.length === 0 && (
              <div style={{ opacity: 0.6 }}>Nothing posted yet.</div>
            )}
            {selected.posts.map((q) => (
              <div
                key={q.id}
                style={{
                  padding: "8px 10px",
                  borderLeft: "3px solid #2c3a5c",
                  marginBottom: 8,
                  background: "#0f1422",
                  borderRadius: 6,
                }}
              >
                <div style={{ opacity: 0.55, fontSize: 12 }}>
                  {KIND_LABEL[q.kind]} sol {q.sol}
                </div>
                <div style={layout.contentText}>{q.text}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
