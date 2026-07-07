import { roadmapGroups, type RoadmapGroup } from "../roadmap";

export function RoadmapPanel({
  open,
  onClose,
  groups = roadmapGroups(),
}: {
  open: boolean;
  onClose: () => void;
  groups?: RoadmapGroup[];
}) {
  if (!open) return null;
  const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <aside
      className="roadmap-panel"
      role="dialog"
      aria-modal="false"
      aria-label="CityLife roadmap"
      data-roadmap-panel="open"
    >
      <div className="roadmap-panel__header">
        <div>
          <span className="roadmap-panel__eyebrow">KOOKER beacon</span>
          <h2>CityLife Roadmap</h2>
          <p>
            Phase-grouped Player &amp; UI lane map · {itemCount} visible slices.
          </p>
        </div>
        <button
          className="roadmap-panel__close"
          data-roadmap-action="close"
          aria-label="Close roadmap HUD"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="roadmap-panel__groups">
        {groups.map((group) => (
          <section
            className={`roadmap-panel__group roadmap-panel__group--${group.phase}`}
            data-roadmap-phase={group.phase}
            key={group.phase}
          >
            <h3>{group.label}</h3>
            <div className="roadmap-panel__items">
              {group.items.map((item) => (
                <article
                  className="roadmap-panel__item"
                  data-roadmap-item={item.id}
                  key={item.id}
                >
                  <div className="roadmap-panel__item-topline">
                    <b>{item.title}</b>
                    <span>{item.lane}</span>
                  </div>
                  <p>{item.summary}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
