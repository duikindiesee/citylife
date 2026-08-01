// PLAYER.GARAGE.1 / SHOWROOM.LOOK.1 — the showroom's baked lighting environment.
//
// WHY THIS FILE EXISTS: the showroom had no environment map at all. In the metal-rough model
// `metalness` is a lerp that moves energy OUT of the diffuse lobe and INTO the specular lobe, so with
// nothing to reflect, `metalness 0.35` on the car body did not add sheen — it deleted 35% of the
// albedo and returned black. That is why a clean red read as muddy brown primer. Populating
// scene.environment is the category change: metalness becomes sheen, the greys pick up a gradient,
// and paint reads as paint. No hex tuning can substitute for it.
//
// The environment is BAKED ONCE (frames={1}) from emissive geometry — zero assets and zero network.
// Deliberately NOT `<Environment preset="...">`: drei's presets fetch HDRIs from the pmndrs CDN at
// runtime, which would make the showroom depend on a third-party host, break offline play and make
// the Playwright run network-flaky.
import { Environment } from "@react-three/drei";
import * as THREE from "three";

/** "Karoo Dusk" — the sky ramp sampled by every reflective surface in the room. */
const DUSK_ZENITH = 0x1b2a4a;
const DUSK_HORIZON = 0x3e5b85;
const DUSK_CLOUDBREAK = 0xefa98a;
const STRUCTURE_VOID = 0x0b0e12;

/** Emitters. These are reflection-only geometry — nobody inspects a reflection, so they are crude. */
const AMBER_WALL = 0xffb975;
const CEILING_STRIP = 0xffd9a0;
const COOL_KICKER = 0x3e8fd0;

/** Baked at 256² — a reflection needs resolution for streak SHAPE, not for detail. ~1.5 MB VRAM. */
const BAKE_RESOLUTION = 256;

/** The visible backdrop sits FURTHER out than the room but inside the camera far plane (100). */
const SKY_RADIUS = 60;

const RAMP_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A four-stop vertical ramp with the warm cloudbreak band sitting just under the horizon, which is
// what puts a warm line along the car's lower shoulder. Written in LINEAR space on purpose: THREE's
// Color converts the sRGB hex literals above for us, and an environment target expects linear.
const RAMP_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 warm;
  uniform vec3 low;
  varying vec3 vDir;
  void main() {
    float y = vDir.y;
    vec3 sky = mix(mid, top, smoothstep(0.06, 1.0, y));
    vec3 ground = mix(low, warm, smoothstep(-0.35, 0.06, y));
    vec3 c = mix(ground, sky, smoothstep(0.0, 0.14, y));
    gl_FragColor = vec4(c, 1.0);
  }
`;

// The same four stops, but for the thing you actually LOOK at: much wider transitions so there is no
// visible seam, the warm band kept low and gentle, and the whole ramp pulled toward the void so the
// car silhouette stays the brightest thing in frame. A backdrop's job is to lose, quietly.
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 warm;
  uniform vec3 low;
  varying vec3 vDir;
  void main() {
    float y = vDir.y;
    vec3 sky = mix(mid, top, smoothstep(-0.05, 0.85, y));
    vec3 ground = mix(low, mix(low, warm, 0.45), smoothstep(-0.6, -0.02, y));
    vec3 c = mix(ground, sky, smoothstep(-0.30, 0.22, y));
    gl_FragColor = vec4(c * 0.55, 1.0);
  }
`;

/** Built once per mount; the uniforms are stable so the bake is genuinely one-shot. */
function rampUniforms() {
  return {
    top: { value: new THREE.Color(DUSK_ZENITH) },
    mid: { value: new THREE.Color(DUSK_HORIZON) },
    warm: { value: new THREE.Color(DUSK_CLOUDBREAK) },
    low: { value: new THREE.Color(STRUCTURE_VOID) },
  };
}

/**
 * The VISIBLE backdrop — a calm gradient dome, replacing the old flat `0xced4d8` clear colour.
 *
 * This is deliberately separate from the environment below. The first attempt showed the environment
 * itself as the background (`<Environment background blur>`), and the emitters that exist to make
 * good REFLECTIONS turned into big orange, cyan and violet blobs with a hard seam across the sky.
 * Reflection geometry is allowed to be crude precisely because nobody inspects a reflection — so it
 * must not be the thing you look at. The backdrop gets its own soft, emitter-free ramp.
 */
export function ShowroomSky() {
  return (
    <mesh name="showroomSky" scale={SKY_RADIUS} renderOrder={-1}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={rampUniforms()}
        vertexShader={RAMP_VERTEX}
        fragmentShader={SKY_FRAGMENT}
      />
    </mesh>
  );
}

/**
 * The reflection environment, baked once at mount. Reflection-only — see ShowroomSky for why.
 */
export function ShowroomEnvironment() {
  return (
    <Environment
      frames={1}
      resolution={BAKE_RESOLUTION}
      environmentIntensity={0.55}
    >
      {/* the dusk sky, seen only as reflection and as the blurred backdrop */}
      <mesh scale={100}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={rampUniforms()}
          vertexShader={RAMP_VERTEX}
          fragmentShader={RAMP_FRAGMENT}
        />
      </mesh>

      {/* the amber interior wall — this is what lands on the car's near shoulder */}
      <mesh position={[0, 3.2, -7]}>
        <planeGeometry args={[18, 6]} />
        <meshBasicMaterial color={AMBER_WALL} toneMapped={false} />
      </mesh>

      {/* TWO CEILING STRIPS — the important part. These produce the long specular streaks running
          down the car's flank, which says "polished clearcoat" faster than any material parameter. */}
      <mesh position={[-3.2, 6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 16]} />
        <meshBasicMaterial color={CEILING_STRIP} toneMapped={false} />
      </mesh>
      <mesh position={[3.2, 6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 16]} />
        <meshBasicMaterial color={CEILING_STRIP} toneMapped={false} />
      </mesh>

      {/* One cool kicker so the far shoulder separates from the dark instead of merging into it.
          Pulled back to [-11, 3.4] and narrowed: closer/larger, it resolved on the polished plinth as
          a hard blue-white blob that read as a lens artifact rather than a reflection. */}
      <mesh position={[-11, 3.4, -2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[5, 2.2]} />
        <meshBasicMaterial color={COOL_KICKER} toneMapped={false} />
      </mesh>
    </Environment>
  );
}
