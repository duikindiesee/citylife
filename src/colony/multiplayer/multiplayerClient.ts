import { serverVehicleKeyOf } from "../car/carAcquisition";

export interface RemoteRacer {
  participantId: string;
  userId: string;
  username: string;
  vehicleKey?: string | null;
  mode?: "driving" | "walking" | "riding_bus";
  isPedestrian?: boolean;
  seatedBusId?: number | null;
  seatIndex?: number | null;
  modeEpoch?: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  carX?: number;
  carY?: number;
  carZ?: number;
  carHeading?: number;
  carSpeed?: number;
  lastSeen: number;
  spec?: any;
}

export type MultiplayerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ServerSnapshotParticipant {
  participantId: string;
  userId?: string;
  alias?: string;
  username?: string;
  vehicleKey?: string | null;
  mode?: "driving" | "walking" | "riding_bus";
  isPedestrian?: boolean;
  seatedBusId?: number | null;
  seatIndex?: number | null;
  modeEpoch?: number;
  protocolVersion?: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  carX?: number;
  carY?: number;
  carZ?: number;
  carHeading?: number;
  carSpeed?: number;
  lastInputSeq?: number;
}

export interface ServerSnapshot {
  type: "snapshot";
  sessionId: string;
  seq: number;
  timestamp: number;
  participants: ServerSnapshotParticipant[];
}

export interface MultiplayerClientOptions {
  url?: string;
  token?: string | null;
  getToken?: () => Promise<string | null>;
  userId: string;
  username: string;
  vehicleKey?: string | null;
  worldId?: string;
  layoutRevision?: string;
  neighbourhoodKey?: string;
  explicitNeighbourhood?: boolean;
  getValidNeighbourhoods?: (worldId?: string, layoutRevision?: string) => string[];
  roomCode?: string;
  autoCreate?: boolean;
  protocolVersion?: number;
  x?: number;
  y?: number;
  z?: number;
  heading?: number;
  speed?: number;
  onStatusChange?: (status: MultiplayerStatus) => void;
  onPeerJoined?: (peer: RemoteRacer) => void;
  onPeerLeft?: (participantId: string) => void;
  onPeerPose?: (
    participantId: string,
    pose: {
      x: number;
      y: number;
      z: number;
      heading: number;
      speed: number;
      mode?: "driving" | "walking" | "riding_bus";
      isPedestrian?: boolean;
      seatedBusId?: number | null;
      seatIndex?: number | null;
      modeEpoch?: number;
      vehicleKey?: string | null;
      carX?: number;
      carY?: number;
      carZ?: number;
      carHeading?: number;
      carSpeed?: number;
    },
  ) => void;
  onSnapshot?: (snapshot: ServerSnapshot) => void;
  onSessionReady?: (sessionId: string, inviteCode: string, participantId: string, worldId?: string, neighbourhoodKey?: string) => void;
  onSelfAdmitted?: (placement: {
    participantId: string;
    x: number;
    y: number;
    z: number;
    heading: number;
    speed: number;
    mode: "driving" | "walking" | "riding_bus";
    seatedBusId?: number | null;
    seatIndex?: number | null;
    modeEpoch?: number;
    protocolVersion?: number;
    vehicleKey?: string | null;
    carX?: number;
    carY?: number;
    carZ?: number;
    carHeading?: number;
    carSpeed?: number;
  }) => void;
  onVehicleExited?: (ack: {
    participantId: string;
    modeEpoch: number;
    x: number;
    y: number;
    z: number;
    heading: number;
    carX?: number;
    carY?: number;
    carZ?: number;
    carHeading?: number;
  }) => void;
  onVehicleBoarded?: (ack: {
    participantId: string;
    modeEpoch: number;
    vehicleKey?: string | null;
    x: number;
    y: number;
    z: number;
    heading: number;
  }) => void;
  onBusBoarded?: (ack: {
    busId: number;
    seatIndex: number;
  }) => void;
  onBusAlighted?: (ack: {
    x: number;
    y: number;
    z: number;
    heading: number;
  }) => void;
  onModeChanged?: (event: {
    mode: "driving" | "walking" | "riding_bus";
    modeEpoch: number;
    isPedestrian: boolean;
    vehicleKey?: string | null;
    seatedBusId?: number | null;
    seatIndex?: number | null;
    x: number;
    y: number;
    z: number;
    heading: number;
    carX?: number;
    carY?: number;
    carZ?: number;
    carHeading?: number;
  }) => void;
  onError?: (error: { code: string; message: string }) => void;
  useCookieAuth?: boolean;
  ensureCookieAuth?: () => Promise<boolean>;
}

const APPROVED_WS_PATHS = new Set([
  "/api/v1/citylife/ws",
  "/kooker/api/v1/citylife/ws",
]);

export function redactUrl(url: string): string {
  try {
    let sanitized = url.replace(/:\/\/([^:@]+):([^@]+)@/, "://[REDACTED]:[REDACTED]@");
    sanitized = sanitized.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, prefix, rawKey) => {
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey).toLowerCase();
      } catch {
        decodedKey = rawKey.toLowerCase();
      }
      if (decodedKey === "jwt" || decodedKey === "token") {
        return `${prefix}${rawKey}=[REDACTED]`;
      }
      return match;
    });
    return sanitized;
  } catch {
    return "[REDACTED]";
  }
}

interface EndpointValidationSuccess {
  ok: true;
  url: string;
}

interface EndpointValidationFailure {
  ok: false;
  reason: string;
}

type EndpointValidationResult = EndpointValidationSuccess | EndpointValidationFailure;

export interface EndpointValidationOptions {
  queryless?: boolean;
}

export function resolveAndValidateEndpoint(
  rawUrl: string | undefined,
  token?: string | null,
  options?: EndpointValidationOptions
): EndpointValidationResult {
  try {
    let parsed: URL;
    const hasWindow = typeof window !== "undefined" && Boolean(window.location);
    const windowProto = hasWindow ? window.location.protocol : "http:";
    const windowHost = hasWindow ? window.location.host.toLowerCase() : "127.0.0.1:8080";
    const windowHostname = hasWindow ? (window.location.hostname || "").toLowerCase() : "127.0.0.1";

    if (!rawUrl) {
      const defaultWsProto = windowProto === "https:" ? "wss:" : "ws:";
      parsed = new URL(`${defaultWsProto}//${windowHost}/api/v1/citylife/ws`);
    } else {
      const normalized = rawUrl.replace(/\\/g, "/");

      if (normalized.startsWith("//")) {
        const defaultWsProto = windowProto === "https:" ? "wss:" : "ws:";
        parsed = new URL(`${defaultWsProto}${normalized}`);
      } else if (/^wss?:\/\//i.test(normalized)) {
        parsed = new URL(normalized);
      } else {
        const base = hasWindow ? (window.location.href || `${windowProto}//${windowHost}/`) : "http://127.0.0.1:8080/";
        parsed = new URL(normalized, base);
      }
    }

    let wsProto = parsed.protocol.toLowerCase();
    if (wsProto === "http:") {
      wsProto = "ws:";
    } else if (wsProto === "https:") {
      wsProto = "wss:";
    }

    if (wsProto !== "ws:" && wsProto !== "wss:") {
      return { ok: false, reason: `Invalid WebSocket protocol: ${parsed.protocol}` };
    }

    if (hasWindow && windowProto === "https:" && wsProto === "ws:") {
      return { ok: false, reason: "Insecure WebSocket protocol (ws:) disallowed on HTTPS origin" };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, reason: "Credential-bearing userinfo in URL is forbidden" };
    }

    if (!APPROVED_WS_PATHS.has(parsed.pathname)) {
      return { ok: false, reason: `Unapproved WebSocket path: ${parsed.pathname}` };
    }

    if (hasWindow) {
      const targetHost = parsed.host.toLowerCase();
      const targetHostname = parsed.hostname.toLowerCase();

      if (targetHost !== windowHost) {
        const isCurrentLoopback =
          windowHostname === "localhost" ||
          windowHostname === "127.0.0.1" ||
          windowHostname === "[::1]";

        const isTargetLoopback =
          targetHostname === "localhost" ||
          targetHostname === "127.0.0.1" ||
          targetHostname === "[::1]";

        if (!isCurrentLoopback || !isTargetLoopback) {
          return { ok: false, reason: `Cross-origin target host forbidden: ${parsed.host}` };
        }
      }
    } else {
      const targetHostname = parsed.hostname.toLowerCase();
      const isTargetLoopback =
        targetHostname === "localhost" ||
        targetHostname === "127.0.0.1" ||
        targetHostname === "[::1]";

      if (!isTargetLoopback) {
        return { ok: false, reason: `Non-loopback host forbidden in test environment: ${parsed.host}` };
      }
    }

    const finalUrl = new URL(parsed.toString());
    finalUrl.protocol = wsProto;

    const keysToRemove: string[] = [];
    for (const key of finalUrl.searchParams.keys()) {
      if (/^(jwt|token)$/i.test(key)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      finalUrl.searchParams.delete(key);
    }

    if (!options?.queryless && token) {
      finalUrl.searchParams.set("jwt", token);
    }

    return { ok: true, url: finalUrl.toString() };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "URL parsing failure" };
  }
}

export function isApprovedEndpoint(urlStr: string, options?: EndpointValidationOptions): boolean {
  return resolveAndValidateEndpoint(urlStr, "probe-token", options).ok;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: MultiplayerStatus = "disconnected";
  private options: MultiplayerClientOptions;
  private sessionId: string | null = null;
  private inviteCode: string | null = null;
  private participantId: string | null = null;
  private worldId: string | null = null;
  private layoutRevision: string | null = null;
  private neighbourhoodKey: string | null = null;
  private protocolVersion: number = 2;
  private modeEpoch: number = 0;
  private inputSeq = 0;
  private currentMode: "driving" | "walking" | "riding_bus" = "driving";
  private seatedBusId: number | null = null;
  private seatIndex: number | null = null;
  private parkedCar?: {
    x: number;
    y: number;
    z: number;
    heading: number;
    speed?: number;
  };
  private lastSnapshotSeq = 0;
  private lastPoseSentAt = 0;
  private lastSentMode: "driving" | "walking" | null = null;
  private pingInterval: any = null;
  private closedExplicitly = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimer: any = null;
  private connectionGeneration = 0;
  private pendingConnectPromise: Promise<void> | null = null;
  private hasNegotiatedNeighbourhood = false;

  constructor(options: MultiplayerClientOptions) {
    this.options = options;
    this.protocolVersion = options.protocolVersion ?? 2;
  }

  public getStatus(): MultiplayerStatus {
    return this.status;
  }

  public getModeEpoch(): number {
    return this.modeEpoch;
  }

  public getProtocolVersion(): number {
    return this.protocolVersion;
  }

  public getMode(): "driving" | "walking" | "riding_bus" {
    return this.currentMode;
  }

  public getSeatedBusId(): number | null {
    return this.seatedBusId;
  }

  public getSeatIndex(): number | null {
    return this.seatIndex;
  }

  public getParkedCar(): { x: number; y: number; z: number; heading: number; speed?: number } | undefined {
    return this.parkedCar ? { ...this.parkedCar } : undefined;
  }

  public getLastSnapshotSeq(): number {
    return this.lastSnapshotSeq;
  }

  public getNextInputSeq(): number {
    return ++this.inputSeq;
  }

  public resetInputSeq(): void {
    this.inputSeq = 0;
  }

  public getSessionInfo(): {
    sessionId: string | null;
    inviteCode: string | null;
    participantId: string | null;
    worldId: string | null;
    layoutRevision: string | null;
    neighbourhoodKey: string | null;
    protocolVersion: number;
    modeEpoch: number;
    mode: "driving" | "walking" | "riding_bus";
    seatedBusId: number | null;
    seatIndex: number | null;
  } {
    return {
      sessionId: this.sessionId,
      inviteCode: this.inviteCode,
      participantId: this.participantId,
      worldId: this.worldId,
      layoutRevision: this.layoutRevision,
      neighbourhoodKey: this.neighbourhoodKey,
      protocolVersion: this.protocolVersion,
      modeEpoch: this.modeEpoch,
      mode: this.currentMode,
      seatedBusId: this.seatedBusId,
      seatIndex: this.seatIndex,
    };
  }

  public updateAccount(account: { userId?: string; username?: string; token?: string }): void {
    const changed =
      (account.userId !== undefined && account.userId !== this.options.userId) ||
      (account.username !== undefined && account.username !== this.options.username) ||
      (account.token !== undefined && account.token !== this.options.token);
    if (!changed) return;
    this.disconnect();
    this.hasNegotiatedNeighbourhood = false;
    this.options = { ...this.options, ...account };
    this.parkedCar = undefined;
    this.modeEpoch = 0;
    this.inputSeq = 0;
    this.currentMode = "driving";
  }

  public connect(): Promise<void> {
    if (this.pendingConnectPromise) {
      return this.pendingConnectPromise;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    this.pendingConnectPromise = this.doConnect().finally(() => {
      this.pendingConnectPromise = null;
    });

    return this.pendingConnectPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.closedExplicitly = false;
    const currentGen = ++this.connectionGeneration;
    this.setStatus("connecting");

    let token = this.options.token;
    if (!token && this.options.getToken) {
      try {
        token = await this.options.getToken();
      } catch {
        console.error("[Multiplayer] Failed to retrieve auth token");
      }
    }

    // Cancel if disconnected or superseded while waiting for token
    if (this.closedExplicitly || this.connectionGeneration !== currentGen) {
      return;
    }

    const isCookieAuth = Boolean(this.options.useCookieAuth);
    if (isCookieAuth && this.options.ensureCookieAuth) {
      let ensured = false;
      try {
        ensured = await this.options.ensureCookieAuth();
      } catch (err) {
        console.warn("[Multiplayer] Failed to ensure cookie session before connect:", err);
      }
      if (this.closedExplicitly || this.connectionGeneration !== currentGen) {
        return;
      }
      if (!ensured) {
        console.warn("[Multiplayer] Failed to ensure cookie session before connect; connection aborted");
        this.setStatus("error");
        if (this.options.onError) {
          this.options.onError({
            code: "UNAUTHORIZED",
            message: "Failed to establish authenticated cookie session",
          });
        }
        return;
      }
    }

    if (!token && !isCookieAuth) {
      console.warn("[Multiplayer] No auth token available; connection aborted");
      this.setStatus("error");
      if (this.options.onError) {
        this.options.onError({ code: "UNAUTHORIZED", message: "Missing required auth token" });
      }
      return;
    }

    const endpointResult = resolveAndValidateEndpoint(this.options.url, token, {
      queryless: isCookieAuth,
    });
    if (!endpointResult.ok) {
      const rawLogged = this.options.url ? redactUrl(this.options.url) : "[default]";
      console.error(
        `[Multiplayer] Rejected unapproved endpoint for authenticated WebSocket (${endpointResult.reason}):`,
        rawLogged,
      );
      this.setStatus("error");
      if (this.options.onError) {
        this.options.onError({
          code: "UNAPPROVED_ENDPOINT",
          message: endpointResult.reason,
        });
      }
      return;
    }

    const targetUrl = endpointResult.url;

    let ws: WebSocket;
    try {
      ws = new WebSocket(targetUrl);
      this.ws = ws;
    } catch {
      console.error("[Multiplayer] WebSocket creation error");
      this.setStatus("error");
      return;
    }

    ws.onopen = () => {
      if (this.connectionGeneration !== currentGen || this.ws !== ws || this.closedExplicitly) {
        return;
      }

      this.startHeartbeat();

      const req: any = {
        type: "join_session",
        inviteCode: this.options.roomCode || "DEFAULT",
        autoCreate: this.options.autoCreate ?? true,
        userId: this.options.userId,
        username: this.options.username,
        protocolVersion: this.options.protocolVersion ?? 2,
      };

      if (this.options.vehicleKey) {
        req.vehicleKey = serverVehicleKeyOf(this.options.vehicleKey);
      }
      if (this.options.worldId) {
        req.worldId = this.options.worldId;
      }
      if (this.options.layoutRevision) {
        req.layoutRevision = this.options.layoutRevision;
      }
      if (this.options.neighbourhoodKey) {
        req.neighbourhoodKey = this.options.neighbourhoodKey;
      }
      if (typeof this.options.x === "number") {
        req.x = this.options.x;
      }
      if (typeof this.options.y === "number") {
        req.y = this.options.y;
      }
      if (typeof this.options.z === "number") {
        req.z = this.options.z;
      }
      if (typeof this.options.heading === "number") {
        req.heading = this.options.heading;
      }
      if (typeof this.options.speed === "number") {
        req.speed = this.options.speed;
      }

      this.send(req);
    };

    ws.onmessage = (event) => {
      if (this.connectionGeneration !== currentGen || this.ws !== ws || this.closedExplicitly) {
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        console.error("[Multiplayer] Failed to parse message");
      }
    };

    ws.onclose = () => {
      if (this.connectionGeneration !== currentGen || this.ws !== ws) {
        return;
      }
      this.stopHeartbeat();
      this.lastPoseSentAt = 0;
      this.lastSentMode = null;
      if (this.closedExplicitly) {
        this.setStatus("disconnected");
        return;
      }

      // Bounded exponential reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delayMs = Math.min(5000, 500 * Math.pow(2, this.reconnectAttempts - 1));
        this.setStatus("connecting");
        this.reconnectTimer = setTimeout(() => {
          void this.connect();
        }, delayMs);
      } else {
        this.setStatus("disconnected");
      }
    };

    ws.onerror = () => {
      if (this.connectionGeneration !== currentGen || this.ws !== ws) {
        return;
      }
      console.error("[Multiplayer] WebSocket connection error");
      this.setStatus("error");
    };
  }

  private rejectAdmission(code: string, message: string): void {
    this.connectionGeneration++;
    this.closedExplicitly = true;
    this.pendingConnectPromise = null;
    this.lastPoseSentAt = 0;
    this.lastSentMode = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close(4400, message);
      } catch {}
    }
    this.sessionId = null;
    this.inviteCode = null;
    this.participantId = null;
    this.worldId = null;
    this.layoutRevision = null;
    this.neighbourhoodKey = null;
    this.lastSnapshotSeq = 0;
    this.setStatus("error");
    if (this.options.onError) {
      this.options.onError({ code, message });
    }
  }

  private handleMessage(msg: any): void {
    const type = msg.type;
    switch (type) {
      case "session_created":
      case "session_joined":
      case "session_reconnected": {
        if (this.options.worldId && msg.worldId !== this.options.worldId) {
          this.rejectAdmission(
            "WORLD_MISMATCH",
            `Server replied with world ${msg.worldId} (expected ${this.options.worldId})`
          );
          return;
        }

        if (this.options.layoutRevision && msg.layoutRevision !== this.options.layoutRevision) {
          this.rejectAdmission(
            "LAYOUT_REVISION_MISMATCH",
            `Server replied with layoutRevision ${msg.layoutRevision} (expected ${this.options.layoutRevision})`
          );
          return;
        }

        const expectedProtocol = this.options.protocolVersion ?? 2;
        if (
          typeof msg.protocolVersion !== "number" ||
          !Number.isSafeInteger(msg.protocolVersion) ||
          msg.protocolVersion !== expectedProtocol
        ) {
          this.rejectAdmission(
            "INVALID_PROTOCOL_VERSION",
            `Server replied with unsupported protocolVersion: ${msg.protocolVersion} (expected ${expectedProtocol})`
          );
          return;
        }

        if (
          typeof msg.modeEpoch !== "number" ||
          !Number.isSafeInteger(msg.modeEpoch) ||
          msg.modeEpoch <= 0
        ) {
          this.rejectAdmission(
            "INVALID_EPOCH",
            `Server replied with missing or invalid modeEpoch: ${msg.modeEpoch}`
          );
          return;
        }

        if (type === "session_reconnected" && this.modeEpoch > 0 && msg.modeEpoch < this.modeEpoch) {
          this.rejectAdmission(
            "EPOCH_MISMATCH",
            `Server replied with stale modeEpoch ${msg.modeEpoch} (local active: ${this.modeEpoch})`
          );
          return;
        }

        const rawMode = msg.mode ?? (msg.isPedestrian ? "walking" : "driving");
        if (rawMode !== "driving" && rawMode !== "walking" && rawMode !== "riding_bus") {
          this.rejectAdmission(
            "INVALID_MODE",
            `Server replied with unrecognized mode: ${rawMode}`
          );
          return;
        }

        this.sessionId = msg.sessionId;
        this.inviteCode = msg.inviteCode;
        this.participantId = msg.participantId;
        this.worldId = msg.worldId ?? null;
        this.layoutRevision = msg.layoutRevision ?? null;
        this.neighbourhoodKey = msg.neighbourhoodKey ?? null;
        this.protocolVersion = msg.protocolVersion;
        this.modeEpoch = msg.modeEpoch;
        this.inputSeq = 0; // Monotonic sequence resets to 0 upon admission / reconnect
        this.lastSnapshotSeq = 0; // Fresh session resets snapshot sequence tracking
        this.currentMode = rawMode;
        if (rawMode === "riding_bus") {
          this.seatedBusId = typeof msg.seatedBusId === "number" ? msg.seatedBusId : null;
          this.seatIndex = typeof msg.seatIndex === "number" ? msg.seatIndex : null;
        } else {
          this.seatedBusId = null;
          this.seatIndex = null;
        }
        const extractValidParkedCarTuple = (raw: any): {
          carX?: number;
          carY?: number;
          carZ?: number;
          carHeading?: number;
          carSpeed?: number;
        } => {
          if (!raw || typeof raw !== "object") return {};
          if (
            typeof raw.carX !== "number" ||
            !Number.isFinite(raw.carX) ||
            typeof raw.carZ !== "number" ||
            !Number.isFinite(raw.carZ) ||
            typeof raw.carHeading !== "number" ||
            !Number.isFinite(raw.carHeading)
          ) {
            return {};
          }
          return {
            carX: raw.carX,
            carY: typeof raw.carY === "number" && Number.isFinite(raw.carY) ? raw.carY : undefined,
            carZ: raw.carZ,
            carHeading: raw.carHeading,
            carSpeed:
              typeof raw.carSpeed === "number" && Number.isFinite(raw.carSpeed)
                ? raw.carSpeed
                : undefined,
          };
        };

        const topCar = extractValidParkedCarTuple(msg);
        const selfPartForCar = Array.isArray(msg.participants)
          ? msg.participants.find(
              (p: any) => p.participantId === msg.participantId || p.userId === this.options.userId
            )
          : undefined;
        const selfCar = selfPartForCar ? extractValidParkedCarTuple(selfPartForCar) : {};
        const resolvedCar = topCar.carX !== undefined ? topCar : selfCar;

        if (
          (this.currentMode === "walking" || this.currentMode === "riding_bus") &&
          resolvedCar.carX !== undefined &&
          resolvedCar.carZ !== undefined &&
          resolvedCar.carHeading !== undefined
        ) {
          this.parkedCar = {
            x: resolvedCar.carX,
            y: resolvedCar.carY ?? 0,
            z: resolvedCar.carZ,
            heading: resolvedCar.carHeading,
            speed: 0,
          };
        } else if (this.currentMode === "driving") {
          this.parkedCar = undefined;
        }
        this.reconnectAttempts = 0; // successfully admitted
        this.setStatus("connected");

        if (this.options.onSessionReady) {
          this.options.onSessionReady(
            msg.sessionId,
            msg.inviteCode,
            msg.participantId,
            msg.worldId,
            msg.neighbourhoodKey
          );
        }

        if (Array.isArray(msg.participants)) {
          const selfPart = msg.participants.find((p: any) => p.participantId === this.participantId);
          if (selfPart && this.options.onSelfAdmitted) {
            if (selfPart.seatedBusId !== undefined) {
              this.seatedBusId = typeof selfPart.seatedBusId === "number" ? selfPart.seatedBusId : null;
            }
            if (selfPart.seatIndex !== undefined) {
              this.seatIndex = typeof selfPart.seatIndex === "number" ? selfPart.seatIndex : null;
            }
            const admittedCar = extractValidParkedCarTuple(selfPart);
            const finalSelfCar = admittedCar.carX !== undefined ? admittedCar : resolvedCar;
            this.options.onSelfAdmitted({
              participantId: selfPart.participantId,
              x: Number.isFinite(selfPart.x) ? selfPart.x : 0,
              y: Number.isFinite(selfPart.y) ? selfPart.y : 0,
              z: Number.isFinite(selfPart.z) ? selfPart.z : 0,
              heading: Number.isFinite(selfPart.heading) ? selfPart.heading : 0,
              speed: Number.isFinite(selfPart.speed) ? selfPart.speed : 0,
              mode: (selfPart.mode ?? (selfPart.isPedestrian ? "walking" : "driving")) as "driving" | "walking" | "riding_bus",
              seatedBusId: selfPart.seatedBusId !== undefined ? selfPart.seatedBusId : this.seatedBusId,
              seatIndex: selfPart.seatIndex !== undefined ? selfPart.seatIndex : this.seatIndex,
              modeEpoch: selfPart.modeEpoch ?? this.modeEpoch,
              protocolVersion: selfPart.protocolVersion ?? this.protocolVersion,
              vehicleKey: selfPart.vehicleKey || null,
              ...finalSelfCar,
            });
          }
          for (const p of msg.participants) {
            if (p.participantId !== this.participantId && this.options.onPeerJoined) {
              const peerCar = extractValidParkedCarTuple(p);
              this.options.onPeerJoined({
                participantId: p.participantId,
                userId: p.userId,
                username: p.username,
                vehicleKey: p.vehicleKey || null,
                mode: (p.mode ?? (p.isPedestrian || !p.vehicleKey ? "walking" : "driving")) as "driving" | "walking" | "riding_bus",
                isPedestrian: Boolean(p.isPedestrian || !p.vehicleKey),
                seatedBusId: p.seatedBusId ?? null,
                seatIndex: p.seatIndex ?? null,
                modeEpoch: p.modeEpoch,
                x: Number.isFinite(p.x) ? p.x : 0,
                y: Number.isFinite(p.y) ? p.y : 0,
                z: Number.isFinite(p.z) ? p.z : 0,
                heading: Number.isFinite(p.heading) ? p.heading : 0,
                speed: Number.isFinite(p.speed) ? p.speed : 0,
                ...peerCar,
                lastSeen: Date.now(),
              });
            }
          }
        }
        break;
      }

      case "peer_joined":
      case "peer_reconnected": {
        if (msg.participant && msg.participant.participantId !== this.participantId) {
          if (this.options.onPeerJoined) {
            const p = msg.participant;
            const validCar =
              typeof p.carX === "number" &&
              Number.isFinite(p.carX) &&
              typeof p.carZ === "number" &&
              Number.isFinite(p.carZ) &&
              typeof p.carHeading === "number" &&
              Number.isFinite(p.carHeading);
            this.options.onPeerJoined({
              participantId: p.participantId,
              userId: p.userId,
              username: p.username,
              vehicleKey: p.vehicleKey || null,
              mode: (p.mode ?? (p.isPedestrian || !p.vehicleKey ? "walking" : "driving")) as "driving" | "walking" | "riding_bus",
              isPedestrian: Boolean(p.isPedestrian || !p.vehicleKey),
              seatedBusId: p.seatedBusId ?? null,
              seatIndex: p.seatIndex ?? null,
              modeEpoch: p.modeEpoch,
              x: Number.isFinite(p.x) ? p.x : 0,
              y: Number.isFinite(p.y) ? p.y : 0,
              z: Number.isFinite(p.z) ? p.z : 0,
              heading: Number.isFinite(p.heading) ? p.heading : 0,
              speed: Number.isFinite(p.speed) ? p.speed : 0,
              carX: validCar ? p.carX : undefined,
              carY: validCar && typeof p.carY === "number" && Number.isFinite(p.carY) ? p.carY : undefined,
              carZ: validCar ? p.carZ : undefined,
              carHeading: validCar ? p.carHeading : undefined,
              carSpeed: validCar && typeof p.carSpeed === "number" && Number.isFinite(p.carSpeed) ? p.carSpeed : undefined,
              lastSeen: Date.now(),
            });
          }
        }
        break;
      }

      case "peer_left": {
        if (msg.participantId && this.options.onPeerLeft) {
          this.options.onPeerLeft(msg.participantId);
        }
        break;
      }

      case "vehicle_exited": {
        if (
          typeof msg.modeEpoch !== "number" ||
          !Number.isSafeInteger(msg.modeEpoch) ||
          msg.modeEpoch <= this.modeEpoch
        ) {
          this.rejectAdmission(
            "INVALID_EPOCH",
            `Vehicle exited receipt has invalid or stale modeEpoch ${msg.modeEpoch} (active: ${this.modeEpoch})`
          );
          return;
        }
        if (
          typeof msg.carX !== "number" ||
          !Number.isFinite(msg.carX) ||
          typeof msg.carZ !== "number" ||
          !Number.isFinite(msg.carZ) ||
          typeof msg.carHeading !== "number" ||
          !Number.isFinite(msg.carHeading)
        ) {
          this.rejectAdmission(
            "MALFORMED_TRANSITION_RECEIPT",
            "Vehicle exited receipt missing or non-finite parked car coordinates"
          );
          return;
        }
        this.modeEpoch = msg.modeEpoch;
        this.inputSeq = 0; // Monotonic sequence resets to 0 on mode transition receipt
        this.currentMode = "walking";
        const carYVal = typeof msg.carY === "number" && Number.isFinite(msg.carY) ? msg.carY : 0;
        this.parkedCar = {
          x: msg.carX,
          y: carYVal,
          z: msg.carZ,
          heading: msg.carHeading,
          speed: 0,
        };
        if (this.options.onVehicleExited) {
          this.options.onVehicleExited({
            participantId: msg.participantId,
            modeEpoch: this.modeEpoch,
            x: Number(msg.x ?? 0),
            y: Number(msg.y ?? 0),
            z: Number(msg.z ?? 0),
            heading: Number(msg.heading ?? 0),
            carX: msg.carX,
            carY: typeof msg.carY === "number" && Number.isFinite(msg.carY) ? msg.carY : undefined,
            carZ: msg.carZ,
            carHeading: msg.carHeading,
          });
        }
        if (this.options.onModeChanged) {
          this.options.onModeChanged({
            mode: "walking",
            modeEpoch: this.modeEpoch,
            isPedestrian: true,
            vehicleKey: this.options.vehicleKey,
            x: Number(msg.x ?? 0),
            y: Number(msg.y ?? 0),
            z: Number(msg.z ?? 0),
            heading: Number(msg.heading ?? 0),
            carX: msg.carX,
            carY: typeof msg.carY === "number" && Number.isFinite(msg.carY) ? msg.carY : undefined,
            carZ: msg.carZ,
            carHeading: msg.carHeading,
          });
        }
        break;
      }

      case "vehicle_boarded": {
        if (
          typeof msg.modeEpoch !== "number" ||
          !Number.isSafeInteger(msg.modeEpoch) ||
          msg.modeEpoch <= this.modeEpoch
        ) {
          this.rejectAdmission(
            "INVALID_EPOCH",
            `Vehicle boarded receipt has invalid or stale modeEpoch ${msg.modeEpoch} (active: ${this.modeEpoch})`
          );
          return;
        }
        this.modeEpoch = msg.modeEpoch;
        this.inputSeq = 0; // Monotonic sequence resets to 0 on mode transition receipt
        this.currentMode = "driving";
        this.parkedCar = undefined;
        if (this.options.onVehicleBoarded) {
          this.options.onVehicleBoarded({
            participantId: msg.participantId,
            modeEpoch: this.modeEpoch,
            vehicleKey: msg.vehicleKey ?? this.options.vehicleKey,
            x: Number(msg.x ?? 0),
            y: Number(msg.y ?? 0),
            z: Number(msg.z ?? 0),
            heading: Number(msg.heading ?? 0),
          });
        }
        if (this.options.onModeChanged) {
          this.options.onModeChanged({
            mode: "driving",
            modeEpoch: this.modeEpoch,
            isPedestrian: false,
            vehicleKey: msg.vehicleKey ?? this.options.vehicleKey,
            x: Number(msg.x ?? 0),
            y: Number(msg.y ?? 0),
            z: Number(msg.z ?? 0),
            heading: Number(msg.heading ?? 0),
          });
        }
        break;
      }

      case "bus_boarded": {
        if (
          typeof msg.modeEpoch !== "number" ||
          !Number.isSafeInteger(msg.modeEpoch) ||
          msg.modeEpoch <= this.modeEpoch
        ) {
          this.rejectAdmission(
            "INVALID_EPOCH",
            `Bus boarded receipt has invalid or stale modeEpoch ${msg.modeEpoch} (active: ${this.modeEpoch})`
          );
          return;
        }
        if (
          typeof msg.busId !== "number" ||
          !Number.isSafeInteger(msg.busId) ||
          msg.busId < 0 ||
          typeof msg.seatIndex !== "number" ||
          !Number.isSafeInteger(msg.seatIndex) ||
          msg.seatIndex < 0
        ) {
          this.rejectAdmission(
            "MALFORMED_TRANSITION_RECEIPT",
            `Bus boarded receipt missing or invalid busId/seatIndex: busId=${msg.busId}, seatIndex=${msg.seatIndex}`
          );
          return;
        }
        const busId = msg.busId;
        const seatIndex = msg.seatIndex;
        this.modeEpoch = msg.modeEpoch;
        this.inputSeq = 0;
        this.currentMode = "riding_bus";
        this.seatedBusId = busId;
        this.seatIndex = seatIndex;
        if (this.options.onBusBoarded) {
          this.options.onBusBoarded({
            busId,
            seatIndex,
          });
        }
        if (this.options.onModeChanged) {
          this.options.onModeChanged({
            mode: "riding_bus",
            modeEpoch: this.modeEpoch,
            isPedestrian: false,
            vehicleKey: null,
            x: typeof msg.x === "number" && Number.isFinite(msg.x) ? msg.x : 0,
            y: typeof msg.y === "number" && Number.isFinite(msg.y) ? msg.y : 0,
            z: typeof msg.z === "number" && Number.isFinite(msg.z) ? msg.z : 0,
            heading: typeof msg.heading === "number" && Number.isFinite(msg.heading) ? msg.heading : 0,
            seatedBusId: busId,
            seatIndex: seatIndex,
          });
        }
        break;
      }

      case "bus_alighted": {
        if (
          typeof msg.modeEpoch !== "number" ||
          !Number.isSafeInteger(msg.modeEpoch) ||
          msg.modeEpoch <= this.modeEpoch
        ) {
          this.rejectAdmission(
            "INVALID_EPOCH",
            `Bus alighted receipt has invalid or stale modeEpoch ${msg.modeEpoch} (active: ${this.modeEpoch})`
          );
          return;
        }
        if (
          typeof msg.x !== "number" ||
          !Number.isFinite(msg.x) ||
          typeof msg.y !== "number" ||
          !Number.isFinite(msg.y) ||
          typeof msg.z !== "number" ||
          !Number.isFinite(msg.z) ||
          typeof msg.heading !== "number" ||
          !Number.isFinite(msg.heading)
        ) {
          this.rejectAdmission(
            "MALFORMED_TRANSITION_RECEIPT",
            "Bus alighted receipt missing or non-finite alight coordinates"
          );
          return;
        }
        const x = msg.x;
        const y = msg.y;
        const z = msg.z;
        const heading = msg.heading;
        this.modeEpoch = msg.modeEpoch;
        this.inputSeq = 0;
        this.currentMode = "walking";
        this.seatedBusId = null;
        this.seatIndex = null;
        if (this.options.onBusAlighted) {
          this.options.onBusAlighted({
            x,
            y,
            z,
            heading,
          });
        }
        if (this.options.onModeChanged) {
          this.options.onModeChanged({
            mode: "walking",
            modeEpoch: this.modeEpoch,
            isPedestrian: true,
            vehicleKey: this.options.vehicleKey,
            x,
            y,
            z,
            heading,
            seatedBusId: null,
            seatIndex: null,
          });
        }
        break;
      }

      case "peer_mode_changed": {
        if (msg.participantId && msg.participantId !== this.participantId) {
          if (this.options.onPeerPose) {
            const validCar =
              typeof msg.carX === "number" &&
              Number.isFinite(msg.carX) &&
              typeof msg.carZ === "number" &&
              Number.isFinite(msg.carZ) &&
              typeof msg.carHeading === "number" &&
              Number.isFinite(msg.carHeading);
            this.options.onPeerPose(msg.participantId, {
              x: Number(msg.x ?? 0),
              y: Number(msg.y ?? 0),
              z: Number(msg.z ?? 0),
              heading: Number(msg.heading ?? 0),
              speed: 0,
              mode: msg.mode === "walking" ? "walking" : msg.mode === "riding_bus" ? "riding_bus" : "driving",
              isPedestrian: Boolean(msg.isPedestrian ?? msg.mode === "walking"),
              seatedBusId: msg.seatedBusId !== undefined ? (msg.seatedBusId !== null ? Number(msg.seatedBusId) : null) : undefined,
              seatIndex: msg.seatIndex !== undefined ? (msg.seatIndex !== null ? Number(msg.seatIndex) : null) : undefined,
              modeEpoch: msg.modeEpoch,
              vehicleKey: msg.vehicleKey !== undefined ? (msg.vehicleKey ? String(msg.vehicleKey) : null) : undefined,
              carX: validCar ? msg.carX : undefined,
              carY: validCar && typeof msg.carY === "number" && Number.isFinite(msg.carY) ? msg.carY : undefined,
              carZ: validCar ? msg.carZ : undefined,
              carHeading: validCar ? msg.carHeading : undefined,
            });
          }
        }
        break;
      }

      case "peer_pose": {
        if (msg.participantId && msg.participantId !== this.participantId) {
          if (this.options.onPeerPose) {
            const validCar =
              typeof msg.carX === "number" &&
              Number.isFinite(msg.carX) &&
              typeof msg.carZ === "number" &&
              Number.isFinite(msg.carZ) &&
              typeof msg.carHeading === "number" &&
              Number.isFinite(msg.carHeading);
            this.options.onPeerPose(msg.participantId, {
              x: Number(msg.x ?? 0),
              y: Number(msg.y ?? 0),
              z: Number(msg.z ?? 0),
              heading: Number(msg.heading ?? 0),
              speed: Number(msg.speed ?? 0),
              mode: msg.mode === "driving" ? "driving" : msg.mode === "riding_bus" ? "riding_bus" : "walking",
              isPedestrian: msg.isPedestrian !== undefined ? Boolean(msg.isPedestrian) : undefined,
              seatedBusId: msg.seatedBusId !== undefined ? (msg.seatedBusId !== null ? Number(msg.seatedBusId) : null) : undefined,
              seatIndex: msg.seatIndex !== undefined ? (msg.seatIndex !== null ? Number(msg.seatIndex) : null) : undefined,
              modeEpoch: msg.modeEpoch,
              vehicleKey: msg.vehicleKey !== undefined ? (msg.vehicleKey ? String(msg.vehicleKey) : null) : undefined,
              carX: validCar ? msg.carX : undefined,
              carY: validCar && typeof msg.carY === "number" && Number.isFinite(msg.carY) ? msg.carY : undefined,
              carZ: validCar ? msg.carZ : undefined,
              carHeading: validCar ? msg.carHeading : undefined,
              carSpeed: validCar && typeof msg.carSpeed === "number" && Number.isFinite(msg.carSpeed) ? msg.carSpeed : undefined,
            });
          }
        }
        break;
      }

      case "snapshot": {
        if (this.status !== "connected" || !this.sessionId) {
          return;
        }
        if (
          typeof msg.sessionId !== "string" ||
          msg.sessionId.length === 0 ||
          msg.sessionId !== this.sessionId
        ) {
          return;
        }
        if (
          typeof msg.seq !== "number" ||
          !Number.isSafeInteger(msg.seq) ||
          msg.seq <= 0 ||
          msg.seq <= this.lastSnapshotSeq
        ) {
          // Drop missing, non-number, non-safe-integer, zero, negative, fractional, or stale/duplicate seq
          return;
        }
        this.lastSnapshotSeq = msg.seq;

        const rawParts: any[] = Array.isArray(msg.participants)
          ? msg.participants
          : Array.isArray(msg.peers)
            ? msg.peers
            : [];
        const snapshot: ServerSnapshot = {
          type: "snapshot",
          sessionId: msg.sessionId,
          seq: msg.seq,
          timestamp: Number(msg.timestamp ?? Date.now()),
          participants: rawParts.map((p) => {
            const validCar =
              typeof p.carX === "number" &&
              Number.isFinite(p.carX) &&
              typeof p.carZ === "number" &&
              Number.isFinite(p.carZ) &&
              typeof p.carHeading === "number" &&
              Number.isFinite(p.carHeading);
            return {
              participantId: p.participantId,
              userId: p.userId,
              alias: p.alias ?? p.username,
              username: p.username ?? p.alias,
              vehicleKey: p.vehicleKey || null,
              mode: p.mode === "driving" ? "driving" : p.mode === "riding_bus" ? "riding_bus" : "walking",
              isPedestrian: p.isPedestrian !== undefined ? Boolean(p.isPedestrian) : p.mode === "walking",
              seatedBusId: p.seatedBusId !== undefined ? (p.seatedBusId !== null ? Number(p.seatedBusId) : null) : undefined,
              seatIndex: p.seatIndex !== undefined ? (p.seatIndex !== null ? Number(p.seatIndex) : null) : undefined,
              modeEpoch: p.modeEpoch,
              protocolVersion: p.protocolVersion,
              x: Number(p.x ?? 0),
              y: Number(p.y ?? 0),
              z: Number(p.z ?? 0),
              heading: Number(p.heading ?? 0),
              speed: Number(p.speed ?? 0),
              carX: validCar ? p.carX : undefined,
              carY: validCar && typeof p.carY === "number" && Number.isFinite(p.carY) ? p.carY : undefined,
              carZ: validCar ? p.carZ : undefined,
              carHeading: validCar ? p.carHeading : undefined,
              carSpeed: validCar && typeof p.carSpeed === "number" && Number.isFinite(p.carSpeed) ? p.carSpeed : undefined,
              lastInputSeq: p.lastInputSeq,
            };
          }),
        };
        const selfSnapPart = snapshot.participants.find(
          (p) => p.participantId === this.participantId || p.userId === this.options.userId
        );
        if (
          selfSnapPart &&
          (selfSnapPart.mode === "walking" || selfSnapPart.mode === "riding_bus") &&
          selfSnapPart.carX !== undefined &&
          selfSnapPart.carZ !== undefined &&
          selfSnapPart.carHeading !== undefined
        ) {
          this.parkedCar = {
            x: selfSnapPart.carX,
            y: selfSnapPart.carY ?? 0,
            z: selfSnapPart.carZ,
            heading: selfSnapPart.carHeading,
            speed: 0,
          };
        }
        if (this.options.onSnapshot) {
          this.options.onSnapshot(snapshot);
        }
        for (const p of snapshot.participants) {
          if (p.participantId && p.participantId !== this.participantId) {
            if (this.options.onPeerPose) {
              this.options.onPeerPose(p.participantId, {
                x: p.x,
                y: p.y,
                z: p.z,
                heading: p.heading,
                speed: p.speed,
                mode: p.mode,
                isPedestrian: p.isPedestrian,
                seatedBusId: p.seatedBusId,
                seatIndex: p.seatIndex,
                modeEpoch: p.modeEpoch,
                vehicleKey: p.vehicleKey,
                carX: p.carX,
                carY: p.carY,
                carZ: p.carZ,
                carHeading: p.carHeading,
                carSpeed: p.carSpeed,
              });
            }
          }
        }
        break;
      }

      case "error": {
        console.error("[Multiplayer] Server error:", msg.error, msg.message);
        if (
          msg.error === "NEIGHBOURHOOD_MISMATCH" &&
          !this.options.explicitNeighbourhood &&
          !this.hasNegotiatedNeighbourhood &&
          !this.closedExplicitly
        ) {
          const match =
            typeof msg.message === "string"
              ? msg.message.match(/^Session belongs to neighbourhood ([a-zA-Z0-9_\-]+)$/)
              : null;
          const advertisedKey =
            (typeof msg.neighbourhoodKey === "string" && msg.neighbourhoodKey.trim().length > 0
              ? msg.neighbourhoodKey.trim()
              : null) ?? (match ? match[1].trim() : null);

          const validNeighbourhoods = this.options.getValidNeighbourhoods
            ? this.options.getValidNeighbourhoods(this.options.worldId, this.options.layoutRevision)
            : [];

          if (advertisedKey && validNeighbourhoods.includes(advertisedKey)) {
            this.hasNegotiatedNeighbourhood = true;
            this.options.neighbourhoodKey = advertisedKey;
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            this.stopHeartbeat();
            if (this.ws) {
              const oldWs = this.ws;
              this.ws = null;
              oldWs.onopen = null;
              oldWs.onmessage = null;
              oldWs.onerror = null;
              oldWs.onclose = null;
              try {
                oldWs.close(1000, "Negotiating neighbourhood");
              } catch {}
            }
            this.reconnectAttempts = 0;
            this.pendingConnectPromise = null;
            void this.connect();
            return;
          }
        }

        if (this.options.onError) {
          this.options.onError({ code: msg.error, message: msg.message });
        }
        if (
          msg.error === "UNAUTHORIZED" ||
          msg.error === "TOKEN_EXPIRED" ||
          msg.error === "IMPERSONATION_REJECTED" ||
          msg.error === "WORLD_MISMATCH" ||
          msg.error === "LAYOUT_REVISION_MISMATCH" ||
          msg.error === "NEIGHBOURHOOD_MISMATCH" ||
          msg.error === "VEHICLE_NOT_OWNED" ||
          msg.error === "COORDINATES_OUT_OF_BOUNDS" ||
          msg.error === "OWNERSHIP_AUTHORITY_ABSENT" ||
          msg.error === "COORDINATE_AUTHORITY_DENIED"
        ) {
          this.connectionGeneration++;
          this.closedExplicitly = true;
          this.pendingConnectPromise = null;
          this.lastPoseSentAt = 0;
          this.lastSentMode = null;
          this.sessionId = null;
          this.inviteCode = null;
          this.participantId = null;
          this.worldId = null;
          this.layoutRevision = null;
          this.neighbourhoodKey = null;
          this.modeEpoch = 0;
          this.inputSeq = 0;
          this.lastSnapshotSeq = 0;
          this.currentMode = "driving";
          this.parkedCar = undefined;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.stopHeartbeat();
          if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            try {
              ws.close(4400, msg.message || msg.error);
            } catch {}
          }
          this.setStatus("error");
        }
        break;
      }
    }
  }

  public sendPose(pose: {
    x: number;
    y: number;
    z?: number;
    heading: number;
    speed: number;
    mode?: "driving" | "walking";
    force?: boolean;
  }): void {
    // Protocol v2 strictly forbids client coordinate authority; server rejects with COORDINATE_AUTHORITY_DENIED.
    if (this.protocolVersion >= 2) {
      return;
    }
    const now = Date.now();
    const mode = pose.mode ?? "walking";
    const modeChanged = this.lastSentMode !== null && this.lastSentMode !== mode;
    // Throttle to max 20Hz (50ms interval) to conserve bandwidth while maintaining smooth client extrapolation,
    // but never drop state-transition poses or explicitly forced updates.
    if (!pose.force && !modeChanged && now - this.lastPoseSentAt < 45) return;
    const sent = this.send({
      type: "pose",
      mode,
      x: pose.x,
      y: pose.y,
      z: pose.z ?? 0,
      heading: pose.heading,
      speed: pose.speed,
    });

    if (sent) {
      this.lastPoseSentAt = now;
      this.lastSentMode = mode;
    }
  }

  public exitVehicle(epoch?: number): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "driving") {
      return false;
    }
    const targetEpoch = epoch !== undefined ? epoch : this.modeEpoch;
    if (typeof targetEpoch !== "number" || !Number.isSafeInteger(targetEpoch) || targetEpoch <= 0) {
      return false;
    }
    return this.send({
      type: "exit_vehicle",
      epoch: targetEpoch,
    });
  }

  public boardVehicle(epoch?: number): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "walking") {
      return false;
    }
    const targetEpoch = epoch !== undefined ? epoch : this.modeEpoch;
    if (typeof targetEpoch !== "number" || !Number.isSafeInteger(targetEpoch) || targetEpoch <= 0) {
      return false;
    }
    return this.send({
      type: "board_vehicle",
      epoch: targetEpoch,
    });
  }

  public boardBus(busId: number, epoch?: number): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "walking") {
      return false;
    }
    if (typeof busId !== "number" || !Number.isSafeInteger(busId) || busId < 0) {
      return false;
    }
    const targetEpoch = epoch !== undefined ? epoch : this.modeEpoch;
    if (typeof targetEpoch !== "number" || !Number.isSafeInteger(targetEpoch) || targetEpoch <= 0) {
      return false;
    }
    return this.send({
      type: "request_board_bus",
      busId,
      epoch: targetEpoch,
    });
  }

  public requestBoardBus(busId: number, epoch?: number): boolean {
    return this.boardBus(busId, epoch);
  }

  public alightBus(epoch?: number): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "riding_bus") {
      return false;
    }
    const targetEpoch = epoch !== undefined ? epoch : this.modeEpoch;
    if (typeof targetEpoch !== "number" || !Number.isSafeInteger(targetEpoch) || targetEpoch <= 0) {
      return false;
    }
    return this.send({
      type: "request_alight_bus",
      epoch: targetEpoch,
    });
  }

  public requestAlightBus(epoch?: number): boolean {
    return this.alightBus(epoch);
  }

  public sendDrivingInput(input: {
    seq?: number;
    epoch?: number;
    throttle?: number;
    steer?: number;
    brake?: boolean;
    mode?: "driving";
  }): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "driving") {
      return false;
    }
    const epoch = input.epoch !== undefined ? input.epoch : this.modeEpoch;
    if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch <= 0) {
      return false;
    }
    const seq = input.seq !== undefined ? input.seq : ++this.inputSeq;
    return this.send({
      type: "input",
      seq,
      epoch,
      mode: "driving",
      throttle: input.throttle ?? 0,
      steer: input.steer ?? 0,
      brake: Boolean(input.brake),
    });
  }

  public sendWalkingInput(input: {
    seq?: number;
    epoch?: number;
    forward?: number;
    strafe?: number;
    heading?: number;
    sprint?: boolean;
    mode?: "walking";
  }): boolean {
    if (this.status !== "connected" || !this.participantId || !this.sessionId || this.modeEpoch <= 0) {
      return false;
    }
    if (this.currentMode !== "walking") {
      return false;
    }
    const epoch = input.epoch !== undefined ? input.epoch : this.modeEpoch;
    if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch <= 0) {
      return false;
    }
    const seq = input.seq !== undefined ? input.seq : ++this.inputSeq;
    return this.send({
      type: "input",
      seq,
      epoch,
      mode: "walking",
      forward: input.forward ?? 0,
      strafe: input.strafe ?? 0,
      heading: input.heading ?? 0,
      sprint: Boolean(input.sprint),
    });
  }

  public sendInput(input: {
    throttle?: number;
    steer?: number;
    brake?: boolean;
    seq?: number;
    epoch?: number;
    mode?: "driving" | "walking";
    forward?: number;
    strafe?: number;
    heading?: number;
    sprint?: boolean;
  }): boolean {
    const isWalking =
      input.mode === "walking" ||
      input.forward !== undefined ||
      input.strafe !== undefined ||
      input.sprint !== undefined;

    if (isWalking) {
      return this.sendWalkingInput({
        seq: input.seq,
        epoch: input.epoch,
        forward: input.forward,
        strafe: input.strafe,
        heading: input.heading,
        sprint: input.sprint,
        mode: "walking",
      });
    } else {
      return this.sendDrivingInput({
        seq: input.seq,
        epoch: input.epoch,
        throttle: input.throttle,
        steer: input.steer,
        brake: input.brake,
        mode: "driving",
      });
    }
  }

  private send(data: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  private setStatus(status: MultiplayerStatus): void {
    this.status = status;
    if (this.options.onStatusChange) {
      this.options.onStatusChange(status);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect(): void {
    this.connectionGeneration++;
    this.closedExplicitly = true;
    this.pendingConnectPromise = null;
    this.lastPoseSentAt = 0;
    this.lastSentMode = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "leave_session" }));
        }
        ws.close();
      } catch {}
    }
    this.sessionId = null;
    this.inviteCode = null;
    this.participantId = null;
    this.worldId = null;
    this.layoutRevision = null;
    this.neighbourhoodKey = null;
    this.inputSeq = 0;
    this.lastSnapshotSeq = 0;
    this.modeEpoch = 0;
    this.currentMode = "driving";
    this.seatedBusId = null;
    this.seatIndex = null;
    this.parkedCar = undefined;
    this.hasNegotiatedNeighbourhood = false;
    this.setStatus("disconnected");
  }
}
