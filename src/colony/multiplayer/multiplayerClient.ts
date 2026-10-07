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

export interface MultiplayerClientOptions {
  url?: string;
  token?: string | null;
  getToken?: () => Promise<string | null>;
  userId: string;
  username: string;
  vehicleKey?: string | null;
  worldId?: string;
  neighbourhoodKey?: string;
  roomCode?: string;
  autoCreate?: boolean;
  onStatusChange?: (status: MultiplayerStatus) => void;
  onPeerJoined?: (peer: RemoteRacer) => void;
  onPeerLeft?: (participantId: string) => void;
  onPeerPose?: (participantId: string, pose: { x: number; y: number; z: number; heading: number; speed: number }) => void;
  onSessionReady?: (sessionId: string, inviteCode: string, participantId: string, worldId?: string, neighbourhoodKey?: string) => void;
  onError?: (error: { code: string; message: string }) => void;
}

function redactUrl(url: string): string {
  return url.replace(/([?&](?:token|jwt)=)[^&]+/gi, "$1[REDACTED]");
}

function isApprovedEndpoint(urlStr: string): boolean {
  try {
    // Only single-slash path is relative to same origin (e.g. /api/v1/citylife/ws)
    if (urlStr.startsWith("/") && !urlStr.startsWith("//")) return true;

    if (typeof window !== "undefined" && window.location) {
      const currentProto = window.location.protocol;
      const currentHost = window.location.host.toLowerCase();
      const currentHostname = (window.location.hostname || "").toLowerCase();

      let parsed: URL;
      if (urlStr.startsWith("//")) {
        parsed = new URL(`${currentProto}${urlStr}`);
      } else if (urlStr.startsWith("ws://") || urlStr.startsWith("wss://")) {
        const httpProto = urlStr.startsWith("wss://") ? "https:" : "http:";
        parsed = new URL(urlStr.replace(/^wss?:/, httpProto));
      } else {
        parsed = new URL(urlStr, `${currentProto}//${window.location.host}`);
      }

      if (parsed.host.toLowerCase() === currentHost) {
        return true;
      }

      // Production HTTPS or non-loopback origin must NOT route credentials to arbitrary loopback services
      const isLocalHost =
        currentHostname === "localhost" ||
        currentHostname === "127.0.0.1" ||
        currentHostname === "[::1]";

      if (isLocalHost) {
        const targetHost = parsed.hostname.toLowerCase();
        if (targetHost === "localhost" || targetHost === "127.0.0.1" || targetHost === "[::1]") {
          return true;
        }
      }

      return false;
    }

    // Node / test environment without window.location: loopback is allowed
    const parsed = new URL(urlStr.replace(/^wss?:/, "http:"), "http://127.0.0.1:8080");
    const h = parsed.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: MultiplayerStatus = "disconnected";
  private options: MultiplayerClientOptions;
  private sessionId: string | null = null;
  private inviteCode: string | null = null;
  private participantId: string | null = null;
  private worldId: string | null = null;
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
    neighbourhoodKey: string | null;
  } {
    return {
      sessionId: this.sessionId,
      inviteCode: this.inviteCode,
      participantId: this.participantId,
      worldId: this.worldId,
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

    const defaultUrl = (() => {
      if (typeof window !== "undefined" && window.location) {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}/api/v1/citylife/ws`;
      }
      return "ws://127.0.0.1:8080/api/v1/citylife/ws";
    })();

    const baseUrl = this.options.url || defaultUrl;

    if (!isApprovedEndpoint(baseUrl)) {
      console.error("[Multiplayer] Rejected unapproved cross-origin endpoint for authenticated WebSocket:", baseUrl);
      this.setStatus("error");
      if (this.options.onError) {
        this.options.onError({
          code: "UNAPPROVED_ENDPOINT",
          message: "WebSocket URL must be same-origin or an approved loopback gateway",
        });
      }
      return;
    }

    let targetUrl = baseUrl;
    const sep = targetUrl.includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}jwt=${encodeURIComponent(token)}&token=${encodeURIComponent(token)}`;

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
        req.vehicleKey = this.options.vehicleKey;
      }
      if (this.options.worldId) {
        req.worldId = this.options.worldId;
      }
      if (this.options.neighbourhoodKey) {
        req.neighbourhoodKey = this.options.neighbourhoodKey;
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

  private handleMessage(msg: any): void {
    const type = msg.type;
    switch (type) {
      case "session_created":
      case "session_joined":
      case "session_reconnected": {
        this.sessionId = msg.sessionId;
        this.inviteCode = msg.inviteCode;
        this.participantId = msg.participantId;
        this.worldId = msg.worldId ?? null;
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
            });
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
          msg.error === "NEIGHBOURHOOD_MISMATCH"
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

  public sendPose(pose: { x: number; y: number; z?: number; heading: number; speed: number }): void {
    const now = Date.now();
    // Throttle to max 20Hz (50ms interval) to conserve bandwidth while maintaining smooth client extrapolation
    if (now - this.lastPoseSentAt < 45) return;
    this.lastPoseSentAt = now;

    this.send({
      type: "pose",
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
    this.neighbourhoodKey = null;
    this.setStatus("disconnected");
  }
}
