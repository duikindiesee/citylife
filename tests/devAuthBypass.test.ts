import { describe, expect, it } from "vitest";
import {
  isLocalBypassHost,
  isLocalDevAuthBypass,
  readDevAuthBypassProbe,
} from "../src/colony/devAuthBypass";

describe("devAuthBypass", () => {
  it("accepts only loopback and private/local hostnames in isLocalBypassHost", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "citylife.local",
      "10.0.0.5",
      "192.168.1.42",
      "172.16.0.1",
      "172.31.255.254",
    ]) {
      expect(isLocalBypassHost(host), `expected ${host} to be local`).toBe(true);
    }

    for (const host of [
      "",
      "citylife.kooker.co.za",
      "app.example.invalid",
      "172.15.0.1",
      "172.32.0.1",
      "11.0.0.1",
      "localhost.example.invalid",
    ]) {
      expect(isLocalBypassHost(host), `expected ${host} to fail closed`).toBe(false);
    }
  });

  it("enforces DEV + local origin + explicit opt-in simultaneously in isLocalDevAuthBypass", () => {
    expect(
      isLocalDevAuthBypass({
        isDev: true,
        hostname: "localhost",
        localTestSetting: false,
        urlSkip: true,
      }),
    ).toBe(true);

    expect(
      isLocalDevAuthBypass({
        isDev: true,
        hostname: "127.0.0.1",
        localTestSetting: true,
        urlSkip: false,
      }),
    ).toBe(true);

    // Production builds must always fail closed
    expect(
      isLocalDevAuthBypass({
        isDev: false,
        hostname: "localhost",
        localTestSetting: true,
        urlSkip: true,
      }),
    ).toBe(false);

    // Non-local hosts must fail closed even in DEV
    expect(
      isLocalDevAuthBypass({
        isDev: true,
        hostname: "citylife.example.invalid",
        localTestSetting: true,
        urlSkip: true,
      }),
    ).toBe(false);

    // Missing explicit opt-in must fail closed even on localhost DEV
    expect(
      isLocalDevAuthBypass({
        isDev: true,
        hostname: "localhost",
        localTestSetting: false,
        urlSkip: false,
      }),
    ).toBe(false);
  });

  it("fails closed when readDevAuthBypassProbe runs without window in Node", () => {
    const probe = readDevAuthBypassProbe();
    expect(probe.hostname).toBe("");
    expect(probe.urlSkip).toBe(false);
    expect(isLocalDevAuthBypass(probe)).toBe(false);
  });
});
