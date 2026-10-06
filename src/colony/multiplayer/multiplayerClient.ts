export interface RemoteRacer {
  participantId: string;
  userId: string;
  username: string;
  vehicleKey: string;
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
  userId: string;
  username: string;
  vehicleKey?: string;
  roomCode?: string;
  onStatusChange?: (status: MultiplayerStatus) => void;
  onPeerJoined?: (peer: RemoteRacer) => void;
  onPeerLeft?: (participantId: string) => void;
  onPeerPose?: (participantId: string, pose: { x: number; y: number; z: number; heading: number; speed: number }) => void;
  onSessionReady?: (sessionId: string, inviteCode: string, participantId: string) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: MultiplayerStatus = "disconnected";
  private options: MultiplayerClientOptions;
  private sessionId: string | null = null;
  private inviteCode: string | null = null;
  private participantId: string | null = null;
  private lastPoseSentAt = 0;
  private pingInterval: any = null;
  private closedExplicitly = false;

  constructor(options: MultiplayerClientOptions) {
    this.options = options;
  }

  public getStatus(): MultiplayerStatus {
    return this.status;
  }

  public getSessionInfo(): { sessionId: string | null; inviteCode: string | null; participantId: string | null } {
    return {
      sessionId: this.sessionId,
      inviteCode: this.inviteCode,
      participantId: this.participantId,
    };
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.closedExplicitly = false;
    this.setStatus("connecting");

    const defaultUrl = (() => {
      if (typeof window !== "undefined" && window.location) {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${proto}//${window.location.host}/ws`;
      }
      return "ws://127.0.0.1:9010/ws";
    })();

    const targetUrl = this.options.url || defaultUrl;

    try {
      this.ws = new WebSocket(targetUrl);
    } catch (err) {
      console.error("[Multiplayer] WebSocket creation error:", err);
      this.setStatus("error");
      return;
    }

    this.ws.onopen = () => {
      this.setStatus("connected");
      this.startHeartbeat();

      // Join or create session
      const req = {
        type: "join_session",
        inviteCode: this.options.roomCode || "DEFAULT",
        autoCreate: true,
        userId: this.options.userId,
        username: this.options.username,
        vehicleKey: this.options.vehicleKey || "karoo-vonk-11",
      };
      this.send(req);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error("[Multiplayer] Failed to parse message:", err);
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.closedExplicitly) {
        this.setStatus("disconnected");
      }
    };

    this.ws.onerror = (err) => {
      console.error("[Multiplayer] WebSocket error:", err);
      this.setStatus("error");
    };
  }

  private handleMessage(msg: any): void {
    const type = msg.type;
    switch (type) {
      case "session_created":
      case "session_joined": {
        this.sessionId = msg.sessionId;
        this.inviteCode = msg.inviteCode;
        this.participantId = msg.participantId;
        if (this.options.onSessionReady) {
          this.options.onSessionReady(msg.sessionId, msg.inviteCode, msg.participantId);
        }

        if (Array.isArray(msg.participants)) {
          for (const p of msg.participants) {
            if (p.participantId !== this.participantId && this.options.onPeerJoined) {
              this.options.onPeerJoined({
                participantId: p.participantId,
                userId: p.userId,
                username: p.username,
                vehicleKey: p.vehicleKey,
                x: p.x,
                y: p.y,
                z: p.z,
                heading: p.heading,
                speed: p.speed,
                lastSeen: Date.now(),
              });
            }
          }
        }
        break;
      }

      case "peer_joined": {
        if (msg.participant && msg.participant.participantId !== this.participantId) {
          if (this.options.onPeerJoined) {
            this.options.onPeerJoined({
              participantId: msg.participant.participantId,
              userId: msg.participant.userId,
              username: msg.participant.username,
              vehicleKey: msg.participant.vehicleKey || "karoo-vonk-11",
              x: 0,
              y: 0,
              z: 0,
              heading: 0,
              speed: 0,
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
    this.closedExplicitly = true;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.send({ type: "leave_session" });
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}
