import { test, expect } from "@playwright/test";

// Spec 127/137 — the ribbon road surface. Asserts the per-cell box renderer is GONE (the
// scene mesh count collapses from ~70k to a few thousand), the merged ribbon renders,
// junctions get their DRAPED caps (spec 137 — every cap vertex rides the road surface at
// +0.205, so caps can neither float nor step the way the old MAX-height slab did), and
// the builder still works (a drawn road grows the ribbon).

test("R3F road ribbons: merged surface, draped junction caps, builder intact", async ({
  page,
}) => {
  // CI.E2E.TIMEOUT.1 — 180s was not enough headroom. Measured on a developer machine this test
  // takes 90-108s ALONE, i.e. it already used 60% of its budget with nothing else competing, and
  // it fails on the hosted runner (which takes 19.1m for the 65-test suite) purely from CPU
  // contention. It passed 2/2 in isolation on the same commit it failed on in CI, which is what
  // proves the failure is scheduling and not behaviour.
  //
  // This is deliberately NOT a blanket raise: several specs in this suite already sit at 240-420s
  // and one at 600s with a note about "the slow CI runner". This brings a heavy boot+build test
  // into line with them instead of leaving it as the narrowest budget in the file.
  test.setTimeout(300000);

  await page.goto("/?skipauth=1");
  await page.waitForSelector("canvas", { timeout: 90000 });
  await page.waitForFunction(
    () => !!(window as any).__r3fScene && !!(window as any).__colony,
    undefined,
    { timeout: 30000 },
  );
  // stage 1 (the city) has arrived when the ribbon layer exists
  await page.waitForFunction(
    () => {
      let found = false;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "RoadRibbons") found = true;
      });
      return found;
    },
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const scene = (window as any).__r3fScene;
    const rt = (window as any).__colony;
    let ribbonMeshes = 0,
      junctionFurniture = 0,
      networkMeshes = 0,
      totalMeshes = 0;
    let capMesh: any = null,
      paintMesh = false;
    scene.traverse((o: any) => {
      if (o.isMesh && !o.isInstancedMesh) totalMeshes++;
    });
    scene.traverse((o: any) => {
      if (o.name === "RoadRibbons")
        o.traverse((m: any) => {
          if (m.isMesh) ribbonMeshes++;
        });
      if (o.name === "RoadJunctionCaps") capMesh = o;
      if (o.name === "RoadJunctionPaint") paintMesh = true;
      if (o.name === "RoadJunctions") junctionFurniture = o.children.length;
      if (o.name === "RoadNetwork")
        o.traverse((m: any) => {
          if (m.isMesh) networkMeshes++;
        });
    });
    // Spec 137 drape probe: every sampled cap vertex must sit at the ROAD surface height
    // + 0.205 — the no-float/no-step invariant the old slab failed by up to 2.1 m.
    // Replicates getSmoothRoadY (max of a 7x7 bilinear footprint) via terrain.worldYAt.
    let maxDrapeError = -1,
      sampled = 0;
    if (capMesh) {
      const t = rt.sim.state.terrain;
      const N = t.size;
      const roadY = (x: number, y: number) => {
        let mx = -9999;
        for (let ix = -3; ix <= 3; ix++)
          for (let iy = -3; iy <= 3; iy++) {
            const h = t.worldYAt(x + ix * 0.2, y + iy * 0.2);
            if (h > mx) mx = h;
          }
        return mx;
      };
      const pos = capMesh.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 60));
      maxDrapeError = 0;
      for (let i = 0; i < pos.count; i += step) {
        const gx = pos.getX(i) / 4 + N / 2;
        const gy = pos.getZ(i) / 4 + N / 2;
        const expected = Math.max(0, roadY(gx, gy)) + 0.205;
        // per-zone anti-coincidence micro-lift adds 0..8mm above the nominal drape
        const dev = pos.getY(i) - expected;
        const err = dev < 0 ? -dev : Math.max(0, dev - 0.009);
        maxDrapeError = Math.max(maxDrapeError, err);
        sampled++;
      }
    }
    return {
      ribbonMeshes,
      hasCaps: !!capMesh,
      paintMesh,
      junctionFurniture,
      maxDrapeError,
      sampled,
      networkMeshes,
      totalMeshes,
      roadWays: rt.sim.state.roadWays?.length ?? -1,
      roadCells: rt.sim.state.roads?.length ?? -1,
    };
  });
  console.log(`ribbons probe: ${JSON.stringify(probe)}`);

  // The merged ribbon surface renders (street/avenue surf + edges + dashes + caps + paint).
  expect(probe.ribbonMeshes).toBeGreaterThanOrEqual(1);
  expect(probe.ribbonMeshes).toBeLessThanOrEqual(8);
  expect(probe.roadWays).toBeGreaterThanOrEqual(1);
  // The boot network has real crossings: the draped cap mesh exists and every sampled
  // vertex rides the road surface within a millimetre.
  expect(probe.hasCaps).toBe(true);
  expect(probe.sampled).toBeGreaterThan(10);
  expect(probe.maxDrapeError).toBeLessThan(0.005);
  // Street furniture exists at real junctions (signals/signs — placement-tested in unit).
  expect(probe.junctionFurniture).toBeGreaterThanOrEqual(1);
  // The per-cell box renderer is GONE: RoadNetwork holds only cul-de-sac bulbs now.
  expect(probe.networkMeshes).toBeLessThan(200);
  // The scene as a whole collapsed: baseline with per-cell roads was ~70,869 meshes.
  expect(probe.totalMeshes).toBeLessThan(8000);
  // The road data (cells for traffic/bus/rally) is untouched.
  expect(probe.roadCells).toBeGreaterThan(100);

  // Capture initial ribbon geometry, sim state, and layout revision before plotting a new road.
  const initialRibbon = await page.evaluate(() => {
    let ribbonMeshCount = 0;
    let totalPositions = 0;
    let totalIndices = 0;
    let groupUuid = "";
    let posHash = 2166136261;
    (window as any).__r3fScene?.traverse((o: any) => {
      if (o.name === "RoadRibbons") {
        groupUuid = o.uuid;
        o.traverse((m: any) => {
          if (m.isMesh && m.geometry) {
            ribbonMeshCount++;
            const pos = m.geometry.attributes?.position;
            if (pos && pos.array) {
              totalPositions += pos.count;
              const arr = pos.array;
              for (let i = 0; i < arr.length; i++) {
                const v = Math.round(arr[i] * 1000);
                posHash = Math.imul(posHash ^ v, 16777619);
              }
            }
            if (m.geometry.index) {
              totalIndices += m.geometry.index.count;
            }
          }
        });
      }
    });
    const rt = (window as any).__colony;
    const sim = rt?.sim;
    const s = sim?.state;
    return {
      ribbonMeshCount,
      totalPositions,
      totalIndices,
      posFingerprint: (posHash >>> 0).toString(16),
      groupUuid,
      waysCount: s?.roadWays?.length ?? 0,
      roadsCount: s?.roads?.length ?? 0,
      roadsVersion: s?.roadsVersion ?? 0,
      signature: `r${s?.roadsVersion ?? 0}:w${s?.roadWays?.length ?? 0}`,
      layoutRevision: rt?.placementContext?.()?.layoutRevision ?? "",
    };
  });
  expect(initialRibbon.ribbonMeshCount).toBeGreaterThanOrEqual(1);
  expect(initialRibbon.totalPositions).toBeGreaterThan(0);
  expect(initialRibbon.layoutRevision).toBeTruthy();

  // Negative controls: verify authoritative survey AND store mutation gate reject invalid strokes
  // while preserving full committed road/way geometry, layout revision, and non-zero rendered Three.js vertices/indices.
  // Render opportunities are provided after each rejected call to verify deferred R3F updates do not mutate scene.
  const negativeControls = await page.evaluate(async (initial) => {
    const rt = (window as any).__colony;
    const store = (window as any).useRoadNetwork.getState();
    const pCtx = rt.placementContext();
    const s = rt.sim.state;

    // Helper to sample rendered ribbon Three.js geometry and compute deterministic full-value fingerprints
    const sampleRibbonGeometry = () => {
      let meshCount = 0;
      let positions = 0;
      let indices = 0;
      let groupUuid = "";
      let posHash = 2166136261;
      let idxHash = 2166136261;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "RoadRibbons") {
          groupUuid = o.uuid;
          o.traverse((m: any) => {
            if (m.isMesh && m.geometry) {
              meshCount++;
              const pos = m.geometry.attributes?.position;
              if (pos && pos.array) {
                positions += pos.count;
                const arr = pos.array;
                for (let i = 0; i < arr.length; i++) {
                  const v = Math.round(arr[i] * 1000);
                  posHash = Math.imul(posHash ^ v, 16777619);
                }
              }
              if (m.geometry.index && m.geometry.index.array) {
                indices += m.geometry.index.count;
                const arr = m.geometry.index.array;
                for (let i = 0; i < arr.length; i++) {
                  idxHash = Math.imul(idxHash ^ arr[i], 16777619);
                }
              }
            }
          });
        }
      });
      return {
        meshCount,
        positions,
        indices,
        groupUuid,
        posFingerprint: (posHash >>> 0).toString(16),
        idxFingerprint: (idxHash >>> 0).toString(16),
      };
    };

    // Render opportunity helper to allow any deferred R3F / React / useSimSignal loops to cycle
    const waitRenderOpportunity = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 30);
          });
        });
      });

    // Snapshot full committed roads (RoadCell contract: x, y, kind) and roadWays before rejected calls
    const preRoads = s.roads.map((r: any) => ({ x: r.x, y: r.y, kind: r.kind }));
    const preWays = (s.roadWays || []).map((w: any) => ({
      path: (w.path || w.points || []).map((p: any) => ({ x: p.x, y: p.y })),
      kind: w.kind,
      width: w.width,
      source: w.source,
    }));
    const preRibbon = sampleRibbonGeometry();

    // 1. Off-world survey and store rejection followed by deferred render opportunity
    const offWorldSurvey = rt.surveyRoadPlacement(
      [{ x: -5, y: -5 }],
      "street",
      pCtx.layoutRevision,
    );
    store.plotRoad(
      [{ x: -5, y: -5 }],
      "street",
      rt.sim,
      pCtx.layoutRevision,
      rt,
    );
    await waitRenderOpportunity();
    const postOffWorldRibbon = sampleRibbonGeometry();

    // 2. Stale layout revision survey and store rejection followed by deferred render opportunity
    const staleRevisionSurvey = rt.surveyRoadPlacement(
      [
        { x: 426, y: 325 },
        { x: 427, y: 324 },
      ],
      "street",
      "stale-revision-invalid",
    );
    store.plotRoad(
      [
        { x: 426, y: 325 },
        { x: 427, y: 324 },
      ],
      "street",
      rt.sim,
      "stale-revision-invalid",
      rt,
    );
    await waitRenderOpportunity();
    const postStaleRibbon = sampleRibbonGeometry();

    // Check full road cell preservation (exact x, y, kind matching RoadCell contract build.ts:136)
    const postRoads = s.roads;
    const roadsIdentical =
      postRoads.length === preRoads.length &&
      postRoads.every(
        (r: any, i: number) =>
          r.x === preRoads[i].x &&
          r.y === preRoads[i].y &&
          r.kind === preRoads[i].kind,
      );

    // Check full roadWay preservation (all paths, kinds, widths, sources)
    const postWays = s.roadWays || [];
    const roadWaysIdentical =
      postWays.length === preWays.length &&
      postWays.every((w: any, i: number) => {
        const pw = preWays[i];
        if (w.kind !== pw.kind || w.width !== pw.width || w.source !== pw.source) return false;
        const pts = w.path || w.points || [];
        if (pts.length !== pw.path.length) return false;
        return pts.every((p: any, pi: number) => p.x === pw.path[pi].x && p.y === pw.path[pi].y);
      });

    const currentRevision = rt.placementContext().layoutRevision;
    const currentSignature = `r${s.roadsVersion}:w${s.roadWays?.length ?? 0}`;

    const geometryPreservedAcrossRejections =
      preRibbon.positions > 0 &&
      postOffWorldRibbon.positions === preRibbon.positions &&
      postOffWorldRibbon.posFingerprint === preRibbon.posFingerprint &&
      postOffWorldRibbon.idxFingerprint === preRibbon.idxFingerprint &&
      postOffWorldRibbon.meshCount === preRibbon.meshCount &&
      postStaleRibbon.positions === preRibbon.positions &&
      postStaleRibbon.posFingerprint === preRibbon.posFingerprint &&
      postStaleRibbon.idxFingerprint === preRibbon.idxFingerprint &&
      postStaleRibbon.meshCount === preRibbon.meshCount;

    return {
      offWorld: {
        ok: offWorldSurvey.ok,
        failures: offWorldSurvey.failures?.map((f: any) => f.code) ?? [],
      },
      staleRevision: {
        ok: staleRevisionSurvey.ok,
        failures: staleRevisionSurvey.failures?.map((f: any) => f.code) ?? [],
      },
      prePositions: preRibbon.positions,
      postPositions: postStaleRibbon.positions,
      preFingerprint: preRibbon.posFingerprint,
      postOffWorldFingerprint: postOffWorldRibbon.posFingerprint,
      postStaleFingerprint: postStaleRibbon.posFingerprint,
      roadsIdentical,
      roadWaysIdentical,
      geometryPreservedAcrossRejections,
      statePreserved:
        roadsIdentical &&
        roadWaysIdentical &&
        geometryPreservedAcrossRejections &&
        s.roadWays.length === initial.waysCount &&
        s.roads.length === initial.roadsCount &&
        s.roadsVersion === initial.roadsVersion &&
        currentRevision === initial.layoutRevision &&
        currentSignature === initial.signature,
      postRejectionWaysCount: s.roadWays.length,
      postRejectionRoadsVersion: s.roadsVersion,
    };
  }, initialRibbon);

  expect(negativeControls.offWorld.ok).toBe(false);
  expect(negativeControls.offWorld.failures).toContain("OUT_OF_BOUNDS");
  expect(negativeControls.staleRevision.ok).toBe(false);
  expect(negativeControls.staleRevision.failures).toContain("STALE_LAYOUT_REVISION");
  expect(negativeControls.prePositions).toBeGreaterThan(0);
  expect(negativeControls.postPositions).toBe(negativeControls.prePositions);
  expect(negativeControls.postOffWorldFingerprint).toBe(negativeControls.preFingerprint);
  expect(negativeControls.postStaleFingerprint).toBe(negativeControls.preFingerprint);
  expect(negativeControls.roadsIdentical).toBe(true);
  expect(negativeControls.roadWaysIdentical).toBe(true);
  expect(negativeControls.geometryPreservedAcrossRejections).toBe(true);
  expect(negativeControls.statePreserved).toBe(true);

  // Builder-not-broken: draw a road through the store using a bounded deterministic stroke;
  // Provenance: endpoint probe 59353 discovered valid 8-cell extension off way endpoint (425, 326) to (433, 318).
  const grown = await page.evaluate(() => {
    const rt = (window as any).__colony;
    const store = (window as any).useRoadNetwork.getState();
    const beforeWays = rt.sim.state.roadWays.length;
    const beforeVersion = rt.sim.state.roadsVersion;
    const pCtx = rt.placementContext();
    const roadSet = rt.sim.state.roadSet as Set<string>;

    let candidate: {
      cells: { x: number; y: number }[];
      layoutRevision: string;
    } | null = null;

    // Deterministic 8-cell stroke extending from waypoint (425, 326) verified by probe 59353
    const deterministicStroke = [
      { x: 426, y: 325 },
      { x: 427, y: 324 },
      { x: 428, y: 323 },
      { x: 429, y: 322 },
      { x: 430, y: 321 },
      { x: 431, y: 320 },
      { x: 432, y: 319 },
      { x: 433, y: 318 },
    ];
    if (!deterministicStroke.some((cell) => roadSet.has(`${cell.x},${cell.y}`))) {
      const survey = rt.surveyRoadPlacement(
        deterministicStroke,
        "street",
        pCtx.layoutRevision,
      );
      if (survey.ok) {
        candidate = {
          cells: deterministicStroke,
          layoutRevision: survey.layoutRevision,
        };
      }
    }

    // Bounded fallback: test endpoints of the first 5 existing ways
    if (!candidate) {
      const ways = rt.sim.state.roadWays || [];
      for (let i = 0; i < Math.min(5, ways.length) && !candidate; i++) {
        const pts = ways[i].path || ways[i].points;
        if (!pts || pts.length < 2) continue;
        const end = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const dx = Math.sign(end.x - prev.x);
        const dy = Math.sign(end.y - prev.y);

        const stroke: { x: number; y: number }[] = [];
        for (let s = 1; s <= 8; s++) {
          stroke.push({ x: end.x + dx * s, y: end.y + dy * s });
        }
        if (!stroke.some((c) => roadSet.has(`${c.x},${c.y}`))) {
          const s = rt.surveyRoadPlacement(stroke, "street", pCtx.layoutRevision);
          if (s.ok) {
            candidate = { cells: stroke, layoutRevision: s.layoutRevision };
            break;
          }
        }
      }
    }

    if (!candidate) throw new Error("no validator-approved road stroke found");
    store.plotRoad(
      candidate.cells,
      "street",
      rt.sim,
      candidate.layoutRevision,
      rt,
    );
    const postRevision = rt.placementContext().layoutRevision;
    const postSignature = `r${rt.sim.state.roadsVersion}:w${rt.sim.state.roadWays.length}`;
    return {
      beforeWays,
      afterWays: rt.sim.state.roadWays.length,
      beforeVersion,
      afterVersion: rt.sim.state.roadsVersion,
      postRevision,
      postSignature,
      strokeCells: candidate.cells.length,
    };
  });
  console.log(`plotRoad ways: ${grown.beforeWays} -> ${grown.afterWays} (stroke length: ${grown.strokeCells})`);
  expect(grown.afterWays).toBe(grown.beforeWays + 1);
  expect(grown.afterVersion).toBe(grown.beforeVersion + 1);
  expect(grown.postRevision).toBe(initialRibbon.layoutRevision);
  expect(grown.postSignature).not.toBe(initialRibbon.signature);

  // ...and the rebuilt ribbon actually re-rendered with new geometry (signature, vertex count & fingerprint change).
  const updatedRibbon = await page.waitForFunction(
    (before) => {
      let currentGroupUuid = "";
      let currentPositions = 0;
      let posHash = 2166136261;
      (window as any).__r3fScene?.traverse((o: any) => {
        if (o.name === "RoadRibbons") {
          currentGroupUuid = o.uuid;
          o.traverse((m: any) => {
            if (m.isMesh && m.geometry?.attributes?.position) {
              const pos = m.geometry.attributes.position;
              currentPositions += pos.count;
              const arr = pos.array;
              if (arr) {
                for (let i = 0; i < arr.length; i++) {
                  const v = Math.round(arr[i] * 1000);
                  posHash = Math.imul(posHash ^ v, 16777619);
                }
              }
            }
          });
        }
      });
      const s = (window as any).__colony?.sim?.state;
      const currentRoadsVersion = s?.roadsVersion ?? 0;
      const currentSignature = `r${currentRoadsVersion}:w${s?.roadWays?.length ?? 0}`;
      const currentPosFingerprint = (posHash >>> 0).toString(16);
      if (
        currentPositions > before.totalPositions &&
        currentRoadsVersion > before.roadsVersion &&
        currentSignature !== before.signature &&
        currentPosFingerprint !== before.posFingerprint
      ) {
        return {
          currentGroupUuid,
          groupRecreated: currentGroupUuid !== before.groupUuid,
          currentPositions,
          currentPosFingerprint,
          diffPositions: currentPositions - before.totalPositions,
          currentRoadsVersion,
          currentSignature,
        };
      }
      return false;
    },
    initialRibbon,
    { timeout: 15000 },
  );

  const ribbonChange = await updatedRibbon.jsonValue();
  expect(ribbonChange.currentPositions).toBeGreaterThan(initialRibbon.totalPositions);
  expect(ribbonChange.currentPosFingerprint).not.toBe(initialRibbon.posFingerprint);
  expect(ribbonChange.currentRoadsVersion).toBeGreaterThan(initialRibbon.roadsVersion);
  expect(ribbonChange.currentSignature).not.toBe(initialRibbon.signature);
});
