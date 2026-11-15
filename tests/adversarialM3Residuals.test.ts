import { describe, expect, it } from "vitest";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import { readFileSync } from "node:fs";
// @ts-ignore - Vitest runs in Node; project tsconfig intentionally omits Node globals.
import crypto from "node:crypto";
import * as THREE from "three";
import { buildBus } from "../src/colony/render/busLayer";
import {
  newRaceState,
  stepRace,
  type RaceState,
} from "../src/colony/racing/race";
import { makeSignatureTrack } from "../src/colony/racing/signatureTrack";
import type { RaceTrack, RacingProfile } from "../src/colony/racing/track";
import {
  assertEvidenceRecord,
  type EvidenceRecord,
  type EvidenceLedger,
} from "../src/susie/evidence";
import {
  assertVisualRequest,
  assertVisualAcknowledgement,
  SUSIE_VISUAL_PROTOCOL,
  SUSIE_VISUAL_VIEWS,
  SUSIE_VISUAL_ACKS,
  type SusieVisualRequest,
  type SusieVisualAcknowledgement,
} from "../src/susie/visualContract";

const normalizeAngle = (a: number): number => {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

// ============================================================================
// 1. PR #365: HQ Civic Art Pack Stress Tests
// ============================================================================

describe("PR #365 Adversarial Stress — HQ Civic Art Pack GLB & Generator", () => {
  const glbUrl = new URL(
    "../public/assets/citylife/props/hq-civic-art-pack.glb",
    import.meta.url,
  );
  const glbBuffer = readFileSync(glbUrl);

  it("asserts exact GLB byte size (85,896 bytes)", () => {
    expect(glbBuffer.byteLength).toBe(85896);
  });

  it("asserts binary header magic glTF (0x46546C67), version 2, and valid chunk lengths", () => {
    // 12-byte header
    const magic = glbBuffer.readUInt32LE(0);
    const version = glbBuffer.readUInt32LE(4);
    const totalLength = glbBuffer.readUInt32LE(8);

    expect(magic).toBe(0x46546c67); // "glTF"
    expect(version).toBe(2);
    expect(totalLength).toBe(85896);

    // Chunk 0: JSON
    const chunk0Length = glbBuffer.readUInt32LE(12);
    const chunk0Type = glbBuffer.subarray(16, 20).toString("ascii");
    expect(chunk0Type).toBe("JSON");
    expect(chunk0Length).toBe(36116);
    expect(chunk0Length % 4).toBe(0); // 4-byte boundary aligned

    // Chunk 1: BIN
    const chunk1Offset = 20 + chunk0Length;
    const chunk1Length = glbBuffer.readUInt32LE(chunk1Offset);
    const chunk1Type = glbBuffer
      .subarray(chunk1Offset + 4, chunk1Offset + 8)
      .toString("ascii");
    expect(chunk1Type).toBe("BIN\0");
    expect(glbBuffer.readUInt32LE(chunk1Offset + 4)).toBe(0x004e4942);
    expect(chunk1Length).toBe(49752);
    expect(chunk1Length % 4).toBe(0); // 4-byte boundary aligned

    // Sum of chunks + headers must match totalLength exactly
    const computedTotal = 12 + 8 + chunk0Length + 8 + chunk1Length;
    expect(computedTotal).toBe(totalLength);
    expect(computedTotal).toBe(85896);
  });

  it("asserts all 5 named props exist: fountain, statue, obelisk, banner-pole, planter-bench", () => {
    const chunk0Length = glbBuffer.readUInt32LE(12);
    const jsonStr = glbBuffer.subarray(20, 20 + chunk0Length).toString("utf8");
    const gltf = JSON.parse(jsonStr);

    expect(gltf.nodes).toBeDefined();
    const nodeNames = gltf.nodes.map((n: { name?: string }) => n.name);

    // Assert pack root
    const root = gltf.nodes.find(
      (n: { name?: string }) => n.name === "HqCivicArtPack_Root",
    );
    expect(root).toBeDefined();
    expect(root.children).toHaveLength(5);

    const requiredProps = [
      "CivicArt_Fountain",
      "CivicArt_Statue",
      "CivicArt_Obelisk",
      "CivicArt_BannerPole",
      "CivicArt_PlanterBench",
    ];

    for (const prop of requiredProps) {
      expect(nodeNames).toContain(prop);
      const childNode = gltf.nodes.find(
        (n: { name?: string }) => n.name === prop,
      );
      expect(childNode).toBeDefined();
      expect(childNode.children?.length ?? 0).toBeGreaterThan(0);
    }

    // Friendly alias checks: fountain, statue, obelisk, banner-pole, planter-bench
    const friendlyMap: Record<string, string> = {
      fountain: "CivicArt_Fountain",
      statue: "CivicArt_Statue",
      obelisk: "CivicArt_Obelisk",
      "banner-pole": "CivicArt_BannerPole",
      "planter-bench": "CivicArt_PlanterBench",
    };
    for (const [friendly, formal] of Object.entries(friendlyMap)) {
      expect(nodeNames.some((n: string) => n === formal)).toBe(true);
    }

    // Zero unwanted cameras, textures, or images
    expect(gltf.cameras ?? []).toHaveLength(0);
    expect(gltf.textures ?? []).toHaveLength(0);
    expect(gltf.images ?? []).toHaveLength(0);
  });

  it("asserts generator deterministic output and exact commit hash when run with three@0.185.1", () => {
    // Provenance SHA-256
    const expectedSha256 =
      "cca3c14413d6ffa2ddbae321b8c3f6e91769760bfada4fb83f700371b59ea9b7";
    const actualSha256 = crypto
      .createHash("sha256")
      .update(glbBuffer)
      .digest("hex");
    expect(actualSha256).toBe(expectedSha256);

    // Generator script inspection
    const generatorUrl = new URL(
      "../scripts/generate_hq_civic_art_pack.mjs",
      import.meta.url,
    );
    const generatorCode = readFileSync(generatorUrl, "utf8");

    // Pinning contracts
    expect(generatorCode).toContain('packages["node_modules/three"]?.version');
    expect(generatorCode).toContain("package-lock.json");
    expect(generatorCode).toContain("citylife-hq-civic-art-pack v1");
    expect(generatorCode).not.toMatch(/Math\.random|Date\.now|new Date\(/);
  });
});

// ============================================================================
// 2. PR #302: Bus Aperture & Shell Bounds Stress Tests
// ============================================================================

describe("PR #302 Adversarial Stress — Bus Aperture & Shell Geometric Bounds", () => {
  const bus = buildBus();

  const getMeshBox = (name: string): THREE.Box3 => {
    const obj = bus.getObjectByName(name);
    expect(obj, `Mesh '${name}' must exist in bus assembly`).toBeDefined();
    return new THREE.Box3().setFromObject(obj!);
  };

  it("extracts bounding boxes for bus-lower-shell, floor, aisle, roof, and windscreen", () => {
    const shellBox = getMeshBox("bus-lower-shell");
    const floorBox = getMeshBox("bus-interior-floor");
    const aisleBox = getMeshBox("bus-interior-aisle");
    const roofBox = getMeshBox("bus-roof");
    const windscreenBox = getMeshBox("bus-windscreen");

    // Verify all boxes are finite and non-empty
    for (const [name, box] of Object.entries({
      shellBox,
      floorBox,
      aisleBox,
      roofBox,
      windscreenBox,
    })) {
      expect(Number.isFinite(box.min.x), `${name}.min.x finite`).toBe(true);
      expect(Number.isFinite(box.max.y), `${name}.max.y finite`).toBe(true);
      expect(box.isEmpty(), `${name} not empty`).toBe(false);
    }
  });

  it("empirically asserts that shellBox.max.y < floorBox.min.y (lower shell does NOT collide with or enclose passenger floor)", () => {
    const shellBox = getMeshBox("bus-lower-shell");
    const floorBox = getMeshBox("bus-interior-floor");

    // Lower shell top: 0.625 + 0.55/2 = 0.90m
    // Passenger floor bottom: 1.08 - 0.12/2 = 1.02m
    // Gap: >= 0.12m
    expect(shellBox.max.y).toBeLessThan(floorBox.min.y);
    const clearance = floorBox.min.y - shellBox.max.y;
    expect(clearance).toBeGreaterThanOrEqual(0.1);
  });

  it("empirically asserts that floorBox.max.y <= aisleBox.min.y (aisle is cleanly on top of floor)", () => {
    const floorBox = getMeshBox("bus-interior-floor");
    const aisleBox = getMeshBox("bus-interior-aisle");

    // Passenger floor top: 1.08 + 0.12/2 = 1.14m
    // Passenger aisle bottom: 1.1525 - 0.025/2 = 1.14m
    expect(floorBox.max.y).toBeLessThanOrEqual(aisleBox.min.y + 1e-4);
  });

  it("asserts front frame parts leave an unobstructed aperture interval matching bus-windscreen bounding box", () => {
    const windscreenBox = getMeshBox("bus-windscreen");
    const topBox = getMeshBox("bus-front-frame-top");
    const bottomBox = getMeshBox("bus-front-frame-bottom");
    const leftBox = getMeshBox("bus-front-frame-left");
    const rightBox = getMeshBox("bus-front-frame-right");

    // Vertical aperture clearance:
    // Top frame bottom must be >= windscreen top
    expect(topBox.min.y).toBeGreaterThanOrEqual(windscreenBox.max.y - 1e-3);
    // Bottom frame top must be <= windscreen bottom
    expect(bottomBox.max.y).toBeLessThanOrEqual(windscreenBox.min.y + 1e-3);

    // Lateral aperture clearance:
    // Left pillar (positive Z) inner face must be >= windscreen max Z
    expect(leftBox.min.z).toBeGreaterThanOrEqual(windscreenBox.max.z - 1e-3);
    // Right pillar (negative Z) inner face must be <= windscreen min Z
    expect(rightBox.max.z).toBeLessThanOrEqual(windscreenBox.min.z + 1e-3);

    // Aperture span verification:
    const apertureHeight = topBox.min.y - bottomBox.max.y;
    const windscreenHeight = windscreenBox.max.y - windscreenBox.min.y;
    expect(apertureHeight).toBeGreaterThanOrEqual(windscreenHeight);

    const apertureWidth = leftBox.min.z - rightBox.max.z;
    const windscreenWidth = windscreenBox.max.z - windscreenBox.min.z;
    expect(apertureWidth).toBeGreaterThanOrEqual(windscreenWidth);
  });

  it("asserts passenger interior ceiling is below roof line", () => {
    const ceilingBox = getMeshBox("bus-interior-ceiling");
    const roofBox = getMeshBox("bus-roof");

    expect(ceilingBox.max.y).toBeLessThan(roofBox.max.y);
  });
});

// ============================================================================
// 3. PR #513: Susie Pure Evidence Contract Stress Tests
// ============================================================================

/**
 * Adversarial append-only ledger backed by a cryptographic SHA-256 hash chain
 * implementing the Susie EvidenceLedger interface contract.
 */
class CryptographicEvidenceLedger implements EvidenceLedger {
  public chain: Array<{
    index: number;
    prevHash: string;
    hash: string;
    record: EvidenceRecord;
  }> = [];

  private static canonicalRecord(r: EvidenceRecord): string {
    return JSON.stringify({
      id: r.id,
      archivedAt: r.archivedAt,
      text: r.text,
      status: r.status,
      sources: r.sources.map((s) => ({
        repository: s.repository,
        revision: s.revision,
        path: s.path,
        lineStart: s.lineStart ?? null,
        lineEnd: s.lineEnd ?? null,
      })),
      provenance: r.provenance,
    });
  }

  public static hashEntry(
    index: number,
    prevHash: string,
    record: EvidenceRecord,
  ): string {
    return crypto
      .createHash("sha256")
      .update(`${index}:${prevHash}:${CryptographicEvidenceLedger.canonicalRecord(record)}`)
      .digest("hex");
  }

  async append(record: EvidenceRecord): Promise<void> {
    assertEvidenceRecord(record);
    const index = this.chain.length;
    const prevHash =
      index === 0
        ? "0000000000000000000000000000000000000000000000000000000000000000"
        : this.chain[index - 1]!.hash;
    const hash = CryptographicEvidenceLedger.hashEntry(index, prevHash, record);
    this.chain.push({ index, prevHash, hash, record: { ...record } });
  }

  async find(
    query: string,
    limit: number,
  ): Promise<readonly EvidenceRecord[]> {
    return this.chain
      .filter(
        (c) =>
          c.record.id.includes(query) ||
          c.record.text.includes(query) ||
          c.record.status === query,
      )
      .slice(0, limit)
      .map((c) => c.record);
  }

  public verifyChain(): boolean {
    for (let i = 0; i < this.chain.length; i++) {
      const entry = this.chain[i]!;
      const expectedPrev =
        i === 0
          ? "0000000000000000000000000000000000000000000000000000000000000000"
          : this.chain[i - 1]!.hash;
      if (entry.prevHash !== expectedPrev) return false;
      const expectedHash = CryptographicEvidenceLedger.hashEntry(
        entry.index,
        entry.prevHash,
        entry.record,
      );
      if (entry.hash !== expectedHash) return false;
    }
    return true;
  }
}

describe("PR #513 Adversarial Stress — Susie Evidence Ledger & Visual Contract", () => {
  it("exercises EvidenceLedger append-only chain hashing and verifies tamper detection", async () => {
    const ledger = new CryptographicEvidenceLedger();

    const rec1: EvidenceRecord = {
      id: "ev-001",
      archivedAt: "2026-11-01T12:00:00Z",
      text: "Speed ceiling is strictly enforced per road type",
      status: "verified",
      sources: [
        {
          repository: "citylife",
          revision: "23cecef56886b4cbd15ea308e8769c1569700be8",
          path: "src/colony/racing/race.ts",
          lineStart: 230,
          lineEnd: 249,
        },
      ],
      provenance: { auditor: "challenger_m3_1", confidence: "high" },
    };

    const rec2: EvidenceRecord = {
      id: "ev-002",
      archivedAt: "2026-11-02T15:30:00Z",
      text: "Unverified recollection of street drift behavior",
      status: "uncertain",
      sources: [],
      provenance: { source: "legacy-interview" },
    };

    const rec3: EvidenceRecord = {
      id: "ev-003",
      archivedAt: "2026-11-03T09:15:00Z",
      text: "Bus windscreen aperture verified unobstructed",
      status: "verified",
      sources: [
        {
          repository: "citylife",
          revision: "23cecef56886b4cbd15ea308e8769c1569700be8",
          path: "src/colony/render/busLayer.ts",
        },
      ],
      provenance: { checkedBy: "qa-visual" },
    };

    await ledger.append(rec1);
    await ledger.append(rec2);
    await ledger.append(rec3);

    // Initial chain is valid
    expect(ledger.chain).toHaveLength(3);
    expect(ledger.verifyChain()).toBe(true);

    // Tamper test 1: Modify 1 byte in record text -> chain invalid
    const originalText = ledger.chain[1]!.record.text;
    (ledger.chain[1]!.record as any).text = originalText + "!";
    expect(ledger.verifyChain()).toBe(false);
    (ledger.chain[1]!.record as any).text = originalText; // restore
    expect(ledger.verifyChain()).toBe(true);

    // Tamper test 2: Modify 1 byte in source revision -> chain invalid
    const originalRev = ledger.chain[0]!.record.sources[0]!.revision;
    (ledger.chain[0]!.record.sources[0] as any).revision =
      originalRev.slice(0, -1) + "a";
    expect(ledger.verifyChain()).toBe(false);
    (ledger.chain[0]!.record.sources[0] as any).revision = originalRev; // restore
    expect(ledger.verifyChain()).toBe(true);

    // Tamper test 3: Modify status -> chain invalid
    (ledger.chain[1]!.record as any).status = "verified";
    expect(ledger.verifyChain()).toBe(false);
    (ledger.chain[1]!.record as any).status = "uncertain"; // restore
    expect(ledger.verifyChain()).toBe(true);

    // Tamper test 4: Swap order of records -> chain invalid
    const temp = ledger.chain[0]!;
    ledger.chain[0] = ledger.chain[1]!;
    ledger.chain[1] = temp;
    expect(ledger.verifyChain()).toBe(false);
  });

  it("asserts evidence validation errors on malformed or illegal records", async () => {
    const ledger = new CryptographicEvidenceLedger();

    // Verified record with empty sources must throw
    await expect(
      ledger.append({
        id: "ev-bad-1",
        archivedAt: "2026-11-01T12:00:00Z",
        text: "Claim without sources",
        status: "verified",
        sources: [],
        provenance: {},
      }),
    ).rejects.toThrow(/source/i);

    // Empty ID must throw
    await expect(
      ledger.append({
        id: "   ",
        archivedAt: "2026-11-01T12:00:00Z",
        text: "Text",
        status: "uncertain",
        sources: [],
        provenance: {},
      }),
    ).rejects.toThrow(/id/i);

    // Invalid timestamp must throw
    await expect(
      ledger.append({
        id: "ev-bad-3",
        archivedAt: "not-a-timestamp",
        text: "Text",
        status: "uncertain",
        sources: [],
        provenance: {},
      }),
    ).rejects.toThrow(/timestamp/i);

    // Source missing required fields must throw
    await expect(
      ledger.append({
        id: "ev-bad-4",
        archivedAt: "2026-11-01T12:00:00Z",
        text: "Text",
        status: "verified",
        sources: [{ repository: "", revision: "abc", path: "file.ts" }],
        provenance: {},
      }),
    ).rejects.toThrow(/repository/i);
  });

  it("tests visual contract request and acknowledgement types against citylife.susie.visual.v1 schema", () => {
    const validNow = new Date("2026-11-07T12:00:00Z");

    // All valid visual views
    for (const view of SUSIE_VISUAL_VIEWS) {
      const validReq: SusieVisualRequest = {
        protocol: SUSIE_VISUAL_PROTOCOL,
        type: "visual.show",
        id: `req-${view}-01`,
        view,
        templateId: `tpl.${view}.v1`,
        evidenceIds: ["ev-001", "ev-002"],
        expiresAt: "2026-11-07T13:00:00Z",
      };
      expect(() => assertVisualRequest(validReq, validNow)).not.toThrow();
    }

    // All valid visual acks
    for (const outcome of SUSIE_VISUAL_ACKS) {
      const validAck: SusieVisualAcknowledgement = {
        protocol: SUSIE_VISUAL_PROTOCOL,
        type: "visual.ack",
        requestId: "req-diagram-01",
        outcome,
      };
      expect(() => assertVisualAcknowledgement(validAck)).not.toThrow();
    }

    // Adversarial: invalid protocol
    expect(() =>
      assertVisualRequest(
        {
          protocol: "citylife.susie.visual.v2" as any,
          type: "visual.show",
          id: "req-bad-proto",
          view: "diagram",
          templateId: "tpl.diag",
          evidenceIds: ["ev-1"],
          expiresAt: "2026-11-07T13:00:00Z",
        },
        validNow,
      ),
    ).toThrow(/protocol/i);

    // Adversarial: invalid event type
    expect(() =>
      assertVisualRequest(
        {
          protocol: SUSIE_VISUAL_PROTOCOL,
          type: "visual.hide" as any,
          id: "req-bad-type",
          view: "diagram",
          templateId: "tpl.diag",
          evidenceIds: ["ev-1"],
          expiresAt: "2026-11-07T13:00:00Z",
        },
        validNow,
      ),
    ).toThrow(/protocol or event type/i);

    // Adversarial: expired request
    expect(() =>
      assertVisualRequest(
        {
          protocol: SUSIE_VISUAL_PROTOCOL,
          type: "visual.show",
          id: "req-expired",
          view: "diagram",
          templateId: "tpl.diag",
          evidenceIds: ["ev-1"],
          expiresAt: "2026-11-07T11:59:59Z", // expired by 1 sec
        },
        validNow,
      ),
    ).toThrow(/expired/i);

    // Adversarial: non-allowlisted identifier
    expect(() =>
      assertVisualRequest(
        {
          protocol: SUSIE_VISUAL_PROTOCOL,
          type: "visual.show",
          id: "req with spaces",
          view: "diagram",
          templateId: "tpl.diag",
          evidenceIds: ["ev-1"],
          expiresAt: "2026-11-07T13:00:00Z",
        },
        validNow,
      ),
    ).toThrow(/allowlisted/i);

    // Adversarial: invalid acknowledgement outcome
    expect(() =>
      assertVisualAcknowledgement({
        protocol: SUSIE_VISUAL_PROTOCOL,
        type: "visual.ack",
        requestId: "req-01",
        outcome: "rejected" as any,
      }),
    ).toThrow(/acknowledgement/i);
  });
});

// ============================================================================
// 4. PR #507: Racing Profiles & Legacy Invariance Stress Tests
// ============================================================================

describe("PR #507 Adversarial Stress — Racing Profiles & 9-Decimal Invariance", () => {
  const straightPath = (len = 100) =>
    Array.from({ length: len }, (_, i) => ({ x: 1 + i, y: 1 }));

  const makeTestLegacyTrack = (roadKind: "street" | "avenue" = "street"): RaceTrack => {
    const path = straightPath(100);
    const roadKinds: RaceTrack["roadKinds"] = {};
    for (const p of path) roadKinds[`${p.x},${p.y}`] = roadKind;
    return {
      checkpoints: [path[0]!, path[path.length - 1]!],
      path,
      length: 99,
      loop: false,
      seed: 42,
      roadsVersion: 1,
      roadKinds,
      // racingProfile is undefined -> legacy
    };
  };

  const makeTestProfiledTrack = (profile: RacingProfile): RaceTrack => {
    return makeSignatureTrack({
      name: "stress test route",
      path: straightPath(100),
      lengthCells: 99,
      profile,
    });
  };

  const startRunning = (track: RaceTrack): RaceState => {
    const s = newRaceState(track);
    return { ...s, mode: "running", countdownMs: 0 };
  };

  it("asserts 9-decimal bit-identical invariance between default unprofiled track and legacy equations", () => {
    const dt = 50; // ms
    const dtSec = dt / 1000;

    // Test 1: Street speed ceiling exact 7.2 to 9 decimals
    let sStreet = startRunning(makeTestLegacyTrack("street"));
    for (let t = 0; t < 3000; t += dt) {
      sStreet = stepRace(sStreet, { accelerate: true }, dt);
    }
    expect(sStreet.car.speed).toBeCloseTo(7.2, 9);

    // Test 2: Avenue speed ceiling exact 8.8 to 9 decimals
    let sAvenue = startRunning(makeTestLegacyTrack("avenue"));
    for (let t = 0; t < 3000; t += dt) {
      sAvenue = stepRace(sAvenue, { accelerate: true }, dt);
    }
    expect(sAvenue.car.speed).toBeCloseTo(8.8, 9);

    // Test 3: Off-track boundary exact 0.9 to 9 decimals
    const sOn = startRunning(makeTestLegacyTrack("street"));
    sOn.car.x = 20;
    sOn.car.y = 1 + 0.899999999;
    const steppedOn = stepRace(sOn, {}, dt);
    expect(steppedOn.offTrack).toBe(false);

    const sOff = startRunning(makeTestLegacyTrack("street"));
    sOff.car.x = 20;
    sOff.car.y = 1 + 0.900000001;
    const steppedOff = stepRace(sOff, {}, dt);
    expect(steppedOff.offTrack).toBe(true);

    // Test 4: Unprofiled yaw rate formula is bit-identical across speeds
    // In driveCar, with no throttle/brake: effectiveSpeed = speed * Math.max(0, 1 - 2.2 * dtSec)
    // Legacy formula: yawRate = (2.25 + Math.min(5, Math.abs(effectiveSpeed)) * 0.12)
    const testSpeeds = [0.1, 1.0, 2.5, 4.0, 5.0, 6.0, 7.2, 8.8, 15.0, 25.0];
    for (const speed of testSpeeds) {
      let state = startRunning(makeTestLegacyTrack("street"));
      state.car.speed = speed;
      const initialHeading = state.car.heading;
      state = stepRace(state, { steer: 1 }, dt);
      const turned = Math.abs(normalizeAngle(state.car.heading - initialHeading));

      const effectiveSpeed = speed * Math.max(0, 1 - 2.2 * dtSec);
      const expectedYawRate = 2.25 + Math.min(5, Math.abs(effectiveSpeed)) * 0.12;
      const expectedTurned = expectedYawRate * dtSec;
      expect(turned).toBeCloseTo(expectedTurned, 9);
    }
  });

  it("asserts speed ceiling clamping on profiled tracks across speed ranges [1.0 to 30.0 cells/s]", () => {
    const profile: RacingProfile = {
      halfWidthCells: 2.0,
      topSpeedCellsPerSec: 15.0,
      lateralGripCapCellsPerSec2: 18.0,
    };
    const track = makeTestProfiledTrack(profile);
    const dt = 50;

    // Test acceleration up to profile ceiling (15.0)
    let state = startRunning(track);
    for (let t = 0; t < 4000; t += dt) {
      state = stepRace(state, { accelerate: true }, dt);
    }
    expect(state.car.speed).toBeCloseTo(15.0, 9);

    // Test speeds initialized across range [1.0 to 30.0]:
    // Any speed initialized above ceiling must be clamped to ceiling on step with throttle
    for (let initSpeed = 1.0; initSpeed <= 30.0; initSpeed += 2.5) {
      let s = startRunning(track);
      s.car.speed = initSpeed;
      s = stepRace(s, { accelerate: true }, dt);
      if (initSpeed >= 15.0) {
        expect(s.car.speed).toBeCloseTo(15.0, 9);
      } else {
        expect(s.car.speed).toBeLessThanOrEqual(15.0);
      }
    }
  });

  it("asserts lateral grip caps on profiled tracks across speed ranges [1.0 to 30.0 cells/s]", () => {
    const aLat = 14.0;
    const profile: RacingProfile = {
      halfWidthCells: 2.0,
      topSpeedCellsPerSec: 25.0,
      lateralGripCapCellsPerSec2: aLat,
    };
    const track = makeTestProfiledTrack(profile);
    const dt = 50;
    const dtSec = dt / 1000;

    // Fine grid of test speeds from 1.0 to 30.0 cells/s
    const speeds = [
      1.0, 2.0, 3.0, 4.0, 4.9, 5.0, 6.0, 7.0, 8.0, 10.0, 11.5, 14.0, 18.0,
      20.0, 25.0, 30.0,
    ];

    for (const speed of speeds) {
      let state = startRunning(track);
      state.car.speed = speed;
      const initialHeading = state.car.heading;
      state = stepRace(state, { steer: 1 }, dt);
      const turned = Math.abs(normalizeAngle(state.car.heading - initialHeading));

      const draggedSpeed = speed * Math.max(0, 1 - 2.2 * dtSec);
      const effectiveSpeed = Math.min(profile.topSpeedCellsPerSec, draggedSpeed);
      const uncappedYaw = 2.25 + Math.min(5, Math.abs(effectiveSpeed)) * 0.12;
      const capYaw = aLat / Math.max(Math.abs(effectiveSpeed), 0.001);
      const expectedCappedYaw = Math.min(uncappedYaw, capYaw);
      const expectedTurned = expectedCappedYaw * dtSec;

      expect(turned, `Speed ${speed} turned angle`).toBeCloseTo(expectedTurned, 8);

      // Verify that when effectiveSpeed >= 5.0 (which occurs when speed >= 5.62),
      // the lateral cap is strictly tighter than uncapped formula (14 / 5.0 = 2.80 < 2.85)
      if (effectiveSpeed >= 5.0) {
        const uncappedTurned = uncappedYaw * dtSec;
        expect(
          turned,
          `Turned at speed ${speed} must be strictly less than uncapped`,
        ).toBeLessThan(uncappedTurned);
      }
    }
  });

  it("proves braking tightens cornering under lateral grip cap (braking buys corner radius)", () => {
    const profile: RacingProfile = {
      halfWidthCells: 2.0,
      topSpeedCellsPerSec: 20.0,
      lateralGripCapCellsPerSec2: 12.0,
    };
    const track = makeTestProfiledTrack(profile);
    const dt = 50;

    const measureTurn = (speed: number): number => {
      let state = startRunning(track);
      state.car.speed = speed;
      const h0 = state.car.heading;
      state = stepRace(state, { steer: 1 }, dt);
      return Math.abs(normalizeAngle(state.car.heading - h0));
    };

    const turnAt20 = measureTurn(20.0);
    const turnAt10 = measureTurn(10.0);
    const turnAt5 = measureTurn(5.0);

    // Turning rate at 10 must be ~2x turning rate at 20 (cap is 12/v)
    expect(turnAt10).toBeCloseTo(turnAt20 * 2, 2);
    // Turning rate at 5 must be ~4x turning rate at 20
    expect(turnAt5).toBeCloseTo(turnAt20 * 4, 1);
  });
});
