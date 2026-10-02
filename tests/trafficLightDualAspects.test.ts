import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import * as THREE from "three";
import { renderToStaticMarkup } from "react-dom/server";

let frameCallback: ((state: any, delta: number) => void) | null = null;

vi.mock("@react-three/fiber", () => ({
  useFrame: vi.fn((cb) => {
    frameCallback = cb;
  }),
}));

vi.mock("@react-three/drei", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

import {
  TrafficLight,
  updateTrafficLightLamps,
  TRAFFIC_LIGHT_OFF,
  TRAFFIC_LIGHT_RED,
  TRAFFIC_LIGHT_AMBER,
  TRAFFIC_LIGHT_GREEN,
} from "../src/colony/render/roadFurniture";

describe("TrafficLight dual-aspect lamp illumination and ref lifecycle", () => {
  beforeEach(() => {
    frameCallback = null;
    vi.clearAllMocks();
  });

  it("updateTrafficLightLamps illuminates both primary and secondary heads across all phases", () => {
    const primaryRed = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const primaryAmber = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const primaryGreen = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const secondaryRed = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const secondaryGreen = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });

    const mats = {
      primaryRed,
      primaryAmber,
      primaryGreen,
      secondaryRed,
      secondaryGreen,
    };

    // 1. Group A Green Phase (t = 2.0s): both primary and secondary green illuminated
    const stateGreenA = updateTrafficLightLamps(mats, 2.0, "A");
    expect(stateGreenA).toBe("green");
    expect(primaryGreen.emissiveIntensity).toBe(1.8);
    expect(primaryGreen.color.getHexString()).toBe(TRAFFIC_LIGHT_GREEN.getHexString());
    expect(secondaryGreen.emissiveIntensity).toBe(1.8);
    expect(secondaryGreen.color.getHexString()).toBe(TRAFFIC_LIGHT_GREEN.getHexString());

    expect(primaryRed.emissiveIntensity).toBe(0);
    expect(primaryRed.color.getHexString()).toBe(TRAFFIC_LIGHT_OFF.getHexString());
    expect(secondaryRed.emissiveIntensity).toBe(0);
    expect(secondaryRed.color.getHexString()).toBe(TRAFFIC_LIGHT_OFF.getHexString());
    expect(primaryAmber.emissiveIntensity).toBe(0);

    // 2. Group A Amber Phase (t = 7.0s): primary amber illuminated, red and green off
    const stateAmberA = updateTrafficLightLamps(mats, 7.0, "A");
    expect(stateAmberA).toBe("amber");
    expect(primaryAmber.emissiveIntensity).toBe(1.8);
    expect(primaryAmber.color.getHexString()).toBe(TRAFFIC_LIGHT_AMBER.getHexString());

    expect(primaryGreen.emissiveIntensity).toBe(0);
    expect(secondaryGreen.emissiveIntensity).toBe(0);
    expect(primaryRed.emissiveIntensity).toBe(0);
    expect(secondaryRed.emissiveIntensity).toBe(0);

    // 3. Group A Red Phase (t = 10.0s): both primary and secondary red illuminated
    const stateRedA = updateTrafficLightLamps(mats, 10.0, "A");
    expect(stateRedA).toBe("red");
    expect(primaryRed.emissiveIntensity).toBe(1.8);
    expect(primaryRed.color.getHexString()).toBe(TRAFFIC_LIGHT_RED.getHexString());
    expect(secondaryRed.emissiveIntensity).toBe(1.8);
    expect(secondaryRed.color.getHexString()).toBe(TRAFFIC_LIGHT_RED.getHexString());

    expect(primaryAmber.emissiveIntensity).toBe(0);
    expect(primaryGreen.emissiveIntensity).toBe(0);
    expect(secondaryGreen.emissiveIntensity).toBe(0);

    // 4. Group B Shifted Cycle (t = 2.0s): Group B is Red while A is Green
    const stateRedB = updateTrafficLightLamps(mats, 2.0, "B");
    expect(stateRedB).toBe("red");
    expect(primaryRed.emissiveIntensity).toBe(1.8);
    expect(secondaryRed.emissiveIntensity).toBe(1.8);
    expect(primaryGreen.emissiveIntensity).toBe(0);
    expect(secondaryGreen.emissiveIntensity).toBe(0);

    // 5. Group B Shifted Cycle (t = 9.0s): Group B is Green
    const stateGreenB = updateTrafficLightLamps(mats, 9.0, "B");
    expect(stateGreenB).toBe("green");
    expect(primaryGreen.emissiveIntensity).toBe(1.8);
    expect(secondaryGreen.emissiveIntensity).toBe(1.8);
    expect(primaryRed.emissiveIntensity).toBe(0);
    expect(secondaryRed.emissiveIntensity).toBe(0);
  });

  it("mounted useFrame drives both primary and secondary signal aspects via separate refs", () => {
    const primaryRed = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const secondaryRed = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const primaryAmber = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const primaryGreen = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });
    const secondaryGreen = new THREE.MeshStandardMaterial({ color: TRAFFIC_LIGHT_OFF });

    const testRefs = {
      primaryRed: { current: primaryRed },
      secondaryRed: { current: secondaryRed },
      primaryAmber: { current: primaryAmber },
      primaryGreen: { current: primaryGreen },
      secondaryGreen: { current: secondaryGreen },
    };

    // Render component tree to static markup, which registers useFrame
    renderToStaticMarkup(
      React.createElement(TrafficLight, {
        position: [10, 0, 20],
        rotationY: 0,
        laneHalfM: 3.5,
        group: "A",
        phase: 0,
        testRefs,
      }),
    );

    expect(frameCallback).not.toBeNull();

    // 1. Simulate frame at clock elapsedTime = 2.0s (Group A Green)
    frameCallback!({ clock: { elapsedTime: 2.0 } }, 0.016);
    expect(primaryGreen.emissiveIntensity).toBe(1.8);
    expect(secondaryGreen.emissiveIntensity).toBe(1.8);
    expect(primaryRed.emissiveIntensity).toBe(0);
    expect(secondaryRed.emissiveIntensity).toBe(0);

    // 2. Simulate frame at clock elapsedTime = 7.0s (Group A Amber)
    frameCallback!({ clock: { elapsedTime: 7.0 } }, 0.016);
    expect(primaryAmber.emissiveIntensity).toBe(1.8);
    expect(primaryGreen.emissiveIntensity).toBe(0);
    expect(secondaryGreen.emissiveIntensity).toBe(0);
    expect(primaryRed.emissiveIntensity).toBe(0);
    expect(secondaryRed.emissiveIntensity).toBe(0);

    // 3. Simulate frame at clock elapsedTime = 10.0s (Group A Red)
    frameCallback!({ clock: { elapsedTime: 10.0 } }, 0.016);
    expect(primaryRed.emissiveIntensity).toBe(1.8);
    expect(secondaryRed.emissiveIntensity).toBe(1.8);
    expect(primaryGreen.emissiveIntensity).toBe(0);
    expect(secondaryGreen.emissiveIntensity).toBe(0);
    expect(primaryAmber.emissiveIntensity).toBe(0);
  });

  it("TrafficLight JSX tree mounts separate and distinct refs for primary vs secondary aspects", () => {
    let capturedElement: React.ReactElement | null = null;
    function ProbeComponent() {
      capturedElement = TrafficLight({
        position: [10, 0, 20],
        rotationY: 0,
        laneHalfM: 3.5,
        group: "A",
        phase: 0,
      });
      return capturedElement;
    }

    renderToStaticMarkup(React.createElement(ProbeComponent));
    expect(capturedElement).not.toBeNull();

    // Helper to collect all meshStandardMaterial elements in the tree
    const materials: any[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (node.type === "meshStandardMaterial") {
        materials.push(node);
      }
      if (node.props?.children) {
        React.Children.forEach(node.props.children, walk);
      }
    };
    walk(capturedElement);

    // Find the materials attached to our signal lens refs
    const attachedRefs = materials.map((m) => m.props?.ref ?? m.ref).filter(Boolean);

    // There are 5 lens refs: overhead red, amber, green, and eye-level red, green
    expect(attachedRefs.length).toBe(5);

    // Assert that all 5 refs are distinct objects, fixing the ref overwrite bug
    const uniqueRefs = new Set(attachedRefs);
    expect(uniqueRefs.size).toBe(5);
  });
});
