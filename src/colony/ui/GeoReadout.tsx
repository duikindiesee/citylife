// BUG.GEO.1 — the on-screen geolocation readout.
//
// The whole point is that a shared screenshot is self-locating: the marker, its spec-152 presence
// address, its grid/world coordinates and the world seed + canonical sol are all burned into the
// frame. This component only FORMATS an already-resolved readout — every privacy decision (exact vs
// coarse) and every projection has already happened in `spatial/presenceReadout`, so the UI cannot
// leak an exact coordinate the policy withheld, and cannot invent one the runtime did not have.
import type {
  PresenceReadout,
  PresenceReadoutEntry,
} from "../spatial/presenceReadout";
import { formatPresenceStamp } from "../spatial/presenceReadout";

function coordinateLines(entry: PresenceReadoutEntry): string[] {
  if (entry.resolution === "coarse" || !entry.fix) return ["location coarse"];
  const { cell, world, withinExtent } = entry.fix;
  const lines: string[] = [];
  if (cell)
    lines.push(
      `grid ${cell.x.toFixed(1)}, ${cell.y.toFixed(1)}${
        withinExtent ? "" : " · outside frame extent"
      }`,
    );
  lines.push(
    `world ${world.x.toFixed(1)}, ${world.y.toFixed(1)}, ${world.z.toFixed(1)}`,
  );
  if (entry.headingDegrees !== null)
    lines.push(`yaw ${entry.headingDegrees.toFixed(0)}°`);
  return lines;
}

function Marker({ entry }: { entry: PresenceReadoutEntry }) {
  return (
    <div
      className={`geo-readout__marker${
        entry.isLocal ? " geo-readout__marker--local" : ""
      }`}
      data-testid={`geo-readout-marker-${entry.subjectId}`}
      data-resolution={entry.resolution}
    >
      <div className="geo-readout__who">
        <span className="geo-readout__dot" aria-hidden="true" />
        <b>{entry.isLocal ? "YOU ARE HERE" : entry.displayName}</b>
        {entry.isLocal && (
          <span className="geo-readout__name">{entry.displayName}</span>
        )}
      </div>
      <div className="geo-readout__address" title={entry.frame.address}>
        {entry.frame.address}
      </div>
      {coordinateLines(entry).map((line) => (
        <div className="geo-readout__coord" key={line}>
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the presence record list. The local player is simply the entry flagged `isLocal` — other
 * bots and future multiplayer peers arrive as more records, not as more UI.
 */
export function GeoReadout({ readout }: { readout: PresenceReadout }) {
  const localHidden = readout.hidden.find((h) => h.isLocal) ?? null;
  const local = readout.entries.find((e) => e.isLocal) ?? null;
  const others = readout.entries.filter((e) => !e.isLocal);
  if (!local && !localHidden && others.length === 0) return null;

  return (
    <div
      className="geo-readout"
      role="status"
      aria-label="Geolocation readout"
      data-testid="geo-readout"
    >
      {local && <Marker entry={local} />}
      {!local && localHidden && (
        // No authoritative pose: say so. Never fall back to a home cell or the world origin — a
        // confident wrong marker is worse than an honest gap on a shared screenshot.
        <div
          className="geo-readout__marker geo-readout__marker--unknown"
          data-testid="geo-readout-unknown"
        >
          <div className="geo-readout__who">
            <b>Position unavailable</b>
          </div>
          <div className="geo-readout__coord">{localHidden.reason}</div>
        </div>
      )}
      {others.length > 0 && (
        <div className="geo-readout__others">
          {others.map((entry) => (
            <Marker entry={entry} key={entry.subjectId} />
          ))}
        </div>
      )}
      <div className="geo-readout__stamp" data-testid="geo-readout-stamp">
        {formatPresenceStamp(readout.stamp)}
      </div>
    </div>
  );
}
