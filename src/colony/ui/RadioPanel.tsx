import { useEffect, useRef, useState } from "react";
import {
  channelEmbedUrl,
  currentChannel,
  anyConfigured,
  type RadioState,
} from "../radio";
import type { ColonyRuntime } from "../runtime";

/** Send a YouTube IFrame Player API command via postMessage. Works as long as the embed URL has
 *  `enablejsapi=1` (it does — see channelEmbedUrl). Avoids reloading the iframe on mute/play. */
function sendYT(
  iframe: HTMLIFrameElement | null,
  func: string,
  args: unknown[] = [],
) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: "command", func, args }),
    "*",
  );
}

/** YouTube error codes that mean the CURRENT video can't play but the playlist might continue. */
const SKIPPABLE_YT_ERRORS = new Set([2, 5, 100, 101, 150]);

/** Low Power Radio — a single compact strip at the TOP-LEFT (off the HUD). The micro-player sits
 *  next to the strip when open so the operator can directly click play if autoplay was blocked.
 *  In TV mode the strip and player tuck into the corner so the city + cinematic fly-around dominate. */
export function RadioPanel({
  runtime,
  radio,
  tv,
}: {
  runtime: ColonyRuntime;
  radio: RadioState;
  tv: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [embedError, setEmbedError] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ch = currentChannel(radio);
  // Iframe loads muted so YouTube + Chrome allow autoplay; unmute is sent via postMessage.
  const url = ch ? channelEmbedUrl(ch, { autoplay: true, muted: true }) : "";
  const wired = anyConfigured(radio);

  // YouTube IFrame Player API event listener — auto-skip blocked tracks, clear errors on play.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube.com" || typeof e.data !== "string")
        return;
      try {
        const m = JSON.parse(e.data);
        if (m.event === "onError" && SKIPPABLE_YT_ERRORS.has(m.info)) {
          setEmbedError(m.info);
          setSkipped((n) => n + 1);
          sendYT(iframeRef.current, "nextVideo");
          sendYT(iframeRef.current, "unMute");
          sendYT(iframeRef.current, "playVideo");
        }
        if (m.event === "onStateChange" && m.info === 1) setEmbedError(null);
      } catch {
        /* non-JSON message — ignore */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!iframeRef.current || !radio.on) return;
    sendYT(iframeRef.current, radio.muted ? "mute" : "unMute");
    if (!radio.muted) sendYT(iframeRef.current, "playVideo");
  }, [radio.muted, radio.on, radio.channelId]);

  useEffect(() => {
    if (!iframeRef.current) return;
    sendYT(iframeRef.current, radio.on ? "playVideo" : "pauseVideo");
  }, [radio.on]);

  useEffect(() => {
    if (!iframeRef.current || !radio.on) return;
    const iframe = iframeRef.current;
    const handshake = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({
          event: "listening",
          id: "citylife",
          channel: "widget",
        }),
        "*",
      );
    };
    iframe.addEventListener("load", handshake);
    handshake();
    return () => iframe.removeEventListener("load", handshake);
  }, [radio.on, radio.channelId]);

  const tunedLabel = radio.on && ch ? ch.name : "Radio";

  return (
    <>
      {/* TOP-LEFT compact strip — off the HUD entirely */}
      <div
        className={`radio-strip ${tv ? "is-tv" : ""} ${open ? "is-open" : ""}`}
      >
        <button
          className="radio-pill"
          onClick={() => setOpen((v) => !v)}
          title="Low Power Radio"
        >
          📻 {tunedLabel}
        </button>
        {open && (
          <div className="radio-pop">
            <div className="radio-pop-channels">
              {radio.channels.map((c) => (
                <button
                  key={c.id}
                  className={`radio-chip ${radio.channelId === c.id ? "on" : ""} ${c.ref ? "" : "empty"}`}
                  onClick={() => runtime.tuneRadio(c.id)}
                  disabled={!c.ref}
                  title={c.ref ? c.vibe : "no playlist configured"}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="radio-pop-controls">
              <button onClick={() => runtime.toggleRadio()}>
                {radio.on ? "⏸" : "▶"}
              </button>
              <button onClick={() => runtime.toggleRadioMuted()}>
                {radio.muted ? "🔇" : "🔈"}
              </button>
              <button onClick={() => runtime.toggleTv()}>
                {tv ? "📺 Exit" : "📺 TV"}
              </button>
            </div>
            {radio.on && !wired && (
              <div className="radio-pop-note">
                Set <code>VITE_RADIO_PLAYLIST_DRIVE</code> in{" "}
                <code>.env.local</code> to a YouTube playlist id.
              </div>
            )}
            {radio.on && radio.muted && (
              <div className="radio-pop-note">
                Click 🔇 once and sound stays on.
              </div>
            )}
            {radio.on && embedError !== null && (
              <div className="radio-pop-err">
                ⚠ YouTube error {embedError} — skipped to next track ({skipped}{" "}
                so far).
              </div>
            )}
          </div>
        )}
      </div>

      {/* YouTube micro-player — visible when the panel is open OR in TV mode */}
      {radio.on && url && (
        <iframe
          ref={iframeRef}
          className={`radio-iframe ${open || tv ? "is-visible" : ""} ${tv ? "is-tv" : ""}`}
          src={url}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="origin-when-cross-origin"
          title="Low Power Radio"
        />
      )}

      {/* TV-mode now-playing card — bottom centre, doesn't compete with the radio strip */}
      {tv && ch && radio.on && (
        <div className="tv-now-playing">
          <span className="tv-tag">LOW POWER RADIO · CINEMATIC</span>
          <b>{ch.name}</b>
          <span>{ch.vibe}</span>
        </div>
      )}
    </>
  );
}
