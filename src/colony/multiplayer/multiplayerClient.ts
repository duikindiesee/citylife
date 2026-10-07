import { serverVehicleKeyOf } from "../car/carAcquisition";

export interface RemoteRacer {
  participantId: string;
  userId: string;
  username: string;
  vehicleKey?: string | null;
  isPedestrian?: boolean;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  lastSeen: number;
}

export type MultiplayerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ServerSnapshotParticipant {
  participantId: string;
  userId?: string;
  alias?: string;
  username?: string;
  vehicleKey?: string | null;
  mode?: "driving" | "walking";
  isPedestrian?: boolean;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
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
  roomCode?: string;
  autoCreate?: boolean;
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
      mode?: "driving" | "walking";
      isPedestrian?: boolean;
      vehicleKey?: string | null;
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
    mode: "driving" | "walking";
    vehicleKey?: string | null;
  }) => void;
  onError?: (error: { code: string; message: string }) => void;
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

export function resolveAndValidateEndpoint(rawUrl: string | undefined, token: string): EndpointValidationResult {
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

    finalUrl.searchParams.set("jwt", token);

    return { ok: true, url: finalUrl.toString() };
  } catch (err: any) {
    return { ok: false, reason: err?.message || "URL parsing failure" };
  }
}

export function isApprovedEndpoint(urlStr: string): boolean {
  return resolveAndValidateEndpoint(urlStr, "probe-token").ok;
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
  private lastPoseSentAt = 0;
  private pingInterval: any = null;
  private closedExplicitly = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimer: any = null;
  private connectionGeneration = 0;
  private pendingConnectPromise: Promise<void> | null = null;

  constructor(options: MultiplayerClientOptions) {
    this.options = options;
  }

  public getStatus(): MultiplayerStatus {
    return this.status;
  }

  public getSessionInfo(): {
    sessionId: string | null;
    inviteCode: string | null;
    participantId: string | null;
    worldId: string | null;
    layoutRevision: string | null;
    neighbourhoodKey: string | null;
  } {
    return {
      sessionId: this.sessionId,
      inviteCode: this.inviteCode,
      participantId: this.participantId,
      worldId: this.worldId,
      layoutRevision: this.layoutRevision,
      neighbourhoodKey: this.neighbourhoodKey,
    };
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

    if (!token) {
      console.warn("[Multiplayer] No auth token available; connection aborted");
      this.setStatus("error");
      if (this.options.onError) {
        this.options.onError({ code: "UNAUTHORIZED", message: "Missing required auth token" });
      }
      return;
    }

    const endpointResult = resolveAndValidateEndpoint(this.options.url, token);
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

        this.sessionId = msg.sessionId;
        this.inviteCode = msg.inviteCode;
        this.participantId = msg.participantId;
        this.worldId = msg.worldId ?? null;
        this.layoutRevision = msg.layoutRevision ?? null;
        this.neighbourhoodKey = msg.neighbourhoodKey ?? null;
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
            this.options.onSelfAdmitted({
              participantId: selfPart.participantId,
              x: Number.isFinite(selfPart.x) ? selfPart.x : 0,
              y: Number.isFinite(selfPart.y) ? selfPart.y : 0,
              z: Number.isFinite(selfPart.z) ? selfPart.z : 0,
              heading: Number.isFinite(selfPart.heading) ? selfPart.heading : 0,
              speed: Number.isFinite(selfPart.speed) ? selfPart.speed : 0,
              mode: selfPart.isPedestrian ? "walking" : "driving",
              vehicleKey: selfPart.vehicleKey || null,
            });
          }
          for (const p of msg.participants) {
            if (p.participantId !== this.participantId && this.options.onPeerJoined) {
              this.options.onPeerJoined({
                participantId: p.participantId,
                userId: p.userId,
                username: p.username,
                vehicleKey: p.vehicleKey || null,
                isPedestrian: Boolean(p.isPedestrian || !p.vehicleKey),
                x: Number.isFinite(p.x) ? p.x : 0,
                y: Number.isFinite(p.y) ? p.y : 0,
                z: Number.isFinite(p.z) ? p.z : 0,
                heading: Number.isFinite(p.heading) ? p.heading : 0,
                speed: Number.isFinite(p.speed) ? p.speed : 0,
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
            this.options.onPeerJoined({
              participantId: msg.participant.participantId,
              userId: msg.participant.userId,
              username: msg.participant.username,
              vehicleKey: msg.participant.vehicleKey || null,
              isPedestrian: Boolean(msg.participant.isPedestrian || !msg.participant.vehicleKey),
              x: Number.isFinite(msg.participant.x) ? msg.participant.x : 0,
              y: Number.isFinite(msg.participant.y) ? msg.participant.y : 0,
              z: Number.isFinite(msg.participant.z) ? msg.participant.z : 0,
              heading: Number.isFinite(msg.participant.heading) ? msg.participant.heading : 0,
              speed: Number.isFinite(msg.participant.speed) ? msg.participant.speed : 0,
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

      case "peer_pose": {
        if (msg.participantId && msg.participantId !== this.participantId) {
          if (this.options.onPeerPose) {
            this.options.onPeerPose(msg.participantId, {
              x: Number(msg.x ?? 0),
              y: Number(msg.y ?? 0),
              z: Number(msg.z ?? 0),
              heading: Number(msg.heading ?? 0),
              speed: Number(msg.speed ?? 0),
              mode: msg.mode === "driving" ? "driving" : "walking",
              isPedestrian: msg.isPedestrian !== undefined ? Boolean(msg.isPedestrian) : undefined,
              vehicleKey: msg.vehicleKey !== undefined ? (msg.vehicleKey ? String(msg.vehicleKey) : null) : undefined,
            });
          }
        }
        break;
      }

      case "snapshot": {
        const rawParts: any[] = Array.isArray(msg.participants)
          ? msg.participants
          : Array.isArray(msg.peers)
            ? msg.peers
            : [];
        const snapshot: ServerSnapshot = {
          type: "snapshot",
          sessionId: msg.sessionId,
          seq: Number(msg.seq ?? 0),
          timestamp: Number(msg.timestamp ?? Date.now()),
          participants: rawParts.map((p) => ({
            participantId: p.participantId,
            userId: p.userId,
            alias: p.alias ?? p.username,
            username: p.username ?? p.alias,
            vehicleKey: p.vehicleKey || null,
            mode: p.mode === "driving" ? "driving" : "walking",
            isPedestrian: p.isPedestrian !== undefined ? Boolean(p.isPedestrian) : p.mode !== "driving",
            x: Number(p.x ?? 0),
            y: Number(p.y ?? 0),
            z: Number(p.z ?? 0),
            heading: Number(p.heading ?? 0),
            speed: Number(p.speed ?? 0),
            lastInputSeq: p.lastInputSeq,
          })),
        };
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
                vehicleKey: p.vehicleKey,
              });
            }
          }
        }
        break;
      }

      case "error": {
        console.error("[Multiplayer] Server error:", msg.error, msg.message);
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
          msg.error === "COORDINATES_OUT_OF_BOUNDS"
        ) {
          this.closedExplicitly = true;
          this.setStatus("error");
          try {
            this.ws?.close();
          } catch {}
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
  }): void {
    const now = Date.now();
    // Throttle to max 20Hz (50ms interval) to conserve bandwidth while maintaining smooth client extrapolation
    if (now - this.lastPoseSentAt < 45) return;
    this.lastPoseSentAt = now;

    this.send({
      type: "pose",
      mode: pose.mode ?? "walking",
      x: pose.x,
      y: pose.y,
      z: pose.z ?? 0,
      heading: pose.heading,
      speed: pose.speed,
    });
  }

  public sendInput(input: { throttle?: number; steer?: number; brake?: boolean; seq?: number }): void {
    this.send({
      type: "input",
      throttle: input.throttle ?? 0,
      steer: input.steer ?? 0,
      brake: Boolean(input.brake),
      seq: input.seq,
    });
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
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
    this.setStatus("disconnected");
  }
}
