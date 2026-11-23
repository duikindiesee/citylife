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
      "LOCALHOST",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "[::1]",
      "citylife.local",
      "CityLife.LOCAL",
      "10.0.0.0",
      "10.0.0.5",
      "10.255.255.255",
      "192.168.0.0",
      "192.168.1.42",
      "192.168.255.255",
      "172.16.0.0",
      "172.16.0.1",
      "172.20.10.2",
      "172.31.255.254",
      "172.31.255.255",
    ]) {
      expect(isLocalBypassHost(host), `expected ${host} to be local`).toBe(true);
    }

    for (const host of [
      "",
      "citylife.kooker.co.za",
      "app.example.invalid",
      "172.15.255.255",
      "172.32.0.0",
      "11.0.0.1",
      "192.169.1.1",
      "localhost.example.invalid",
      "10.kooker.co.za",
      "192.168.evil.example",
      "172.16.evil.example",
      "10.0.0.1.evil.example",
      "10.256.0.1",
      "192.168.1.256",
      "172.16.0.256",
      "10.1.2",
      "10.1.2.3.4",
      "10.01.0.1",
      "localhost:5173",
      "10.0.0.1:5173",
      "10.0.0.1:80.evil.example",
      "localhost.",
      "citylife.local.",
      "10.0.0.1.",
      ".local",
      "foo..local",
      " localhost",
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
