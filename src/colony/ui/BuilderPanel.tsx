import { useRoadNetwork } from "../stores/useRoadNetwork";

export function BuilderPanel() {
  const { builderActive, toggleBuilder, worldViewActive, toggleWorldView, builderMode, setBuilderMode, saveToDB, loadFromDB } = useRoadNetwork();
  
  if (!builderActive && !worldViewActive) {
    return (
      <div className="group">
        <button onClick={toggleWorldView} title="Enter Aerial World View">
          🌍 World View
        </button>
        <button onClick={toggleBuilder} title="Enter City Builder Mode">
          🏗️ City Builder
        </button>
      </div>
    );
  }

  if (worldViewActive) {
    return (
      <div className="group">
        <button 
          onClick={toggleWorldView} 
          style={{ color: '#ff6b6b' }}
          title="Exit World View"
        >
          Exit World View
        </button>
      </div>
    );
  }

  const activeRoadType = useRoadNetwork(state => state.activeRoadType);
  const setActiveRoadType = useRoadNetwork(state => state.setActiveRoadType);

  const getCategory = () => {
    if (builderMode === 'roads') return 'roads';
    if (builderMode.startsWith('zoning_')) return 'zoning';
    if (['raise', 'lower', 'flatten'].includes(builderMode)) return 'landscaping';
    if (builderMode === 'bulldoze') return 'bulldoze';
    return null;
  };

  const category = getCategory();

  return (
    <>
      <div className="group">
        <button 
          onClick={toggleBuilder} 
          style={{ color: '#ff6b6b' }}
          title="Exit City Builder"
        >
          Exit Builder
        </button>
      </div>

      <div style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(16, 20, 30, 0.95)',
        border: '1px solid rgba(87, 209, 196, 0.2)',
        backdropFilter: 'blur(12px)',
        padding: '16px 24px',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        alignItems: 'center',
        zIndex: 1000,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
        transition: 'all 0.3s ease'
      }}>
        {/* Tier 1: Submenus */}
        {category && category !== 'bulldoze' && (
          <div style={{
            display: 'flex',
            gap: '10px',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            alignItems: 'center'
          }}>
            {category === 'roads' && (
              <>
                <button
                  style={{
                    background: activeRoadType === 'street' ? '#57d1c4' : 'rgba(255, 255, 255, 0.05)',
                    color: activeRoadType === 'street' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setBuilderMode('roads');
                    setActiveRoadType('street');
                  }}
                >
                  Street 🛣️
                </button>
                <button
                  style={{
                    background: activeRoadType === 'gravel' ? '#57d1c4' : 'rgba(255, 255, 255, 0.05)',
                    color: activeRoadType === 'gravel' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setBuilderMode('roads');
                    setActiveRoadType('gravel');
                  }}
                >
                  Gravel Avenue 🪨
                </button>
              </>
            )}

            {category === 'zoning' && (
              <>
                <button
                  style={{
                    background: builderMode === 'zoning_residential' ? '#55ff55' : 'rgba(255, 255, 255, 0.05)',
                    color: builderMode === 'zoning_residential' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setBuilderMode('zoning_residential')}
                >
                  Residential Plot 🏠
                </button>
                <button
                  style={{
                    background: builderMode === 'zoning_commercial' ? '#55cfff' : 'rgba(255, 255, 255, 0.05)',
                    color: builderMode === 'zoning_commercial' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setBuilderMode('zoning_commercial')}
                >
                  Commercial Plot 🏢
                </button>
              </>
            )}

            {category === 'landscaping' && (
              <>
                <button
                  style={{
                    background: builderMode === 'raise' ? '#57d1c4' : 'rgba(255, 255, 255, 0.05)',
                    color: builderMode === 'raise' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setBuilderMode('raise')}
                >
                  Raise 🏔️
                </button>
                <button
                  style={{
                    background: builderMode === 'lower' ? '#57d1c4' : 'rgba(255, 255, 255, 0.05)',
                    color: builderMode === 'lower' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setBuilderMode('lower')}
                >
                  Lower 🕳️
                </button>
                <button
                  style={{
                    background: builderMode === 'flatten' ? '#57d1c4' : 'rgba(255, 255, 255, 0.05)',
                    color: builderMode === 'flatten' ? '#04231f' : '#e8edf7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setBuilderMode('flatten')}
                >
                  Flatten ➖
                </button>
              </>
            )}
          </div>
        )}

        {/* Tier 2: Category Selector */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button 
            className={category === 'roads' ? 'on' : ''}
            onClick={() => setBuilderMode('roads')}
            style={{ padding: '8px 16px', fontSize: '1.1em', cursor: 'pointer', border: 'none', borderRadius: '8px' }}
          >
            🛣️ Roads
          </button>
          <button 
            className={category === 'zoning' ? 'on' : ''}
            onClick={() => setBuilderMode('zoning_residential')}
            style={{ padding: '8px 16px', fontSize: '1.1em', cursor: 'pointer', border: 'none', borderRadius: '8px' }}
          >
            🟩 Zoning
          </button>
          <button 
            className={category === 'landscaping' ? 'on' : ''}
            onClick={() => setBuilderMode('raise')}
            style={{ padding: '8px 16px', fontSize: '1.1em', cursor: 'pointer', border: 'none', borderRadius: '8px' }}
          >
            🏔️ Landscaping
          </button>
          <button 
            className={category === 'bulldoze' ? 'on' : ''}
            onClick={() => setBuilderMode('bulldoze')}
            style={{ padding: '8px 16px', fontSize: '1.1em', cursor: 'pointer', border: 'none', borderRadius: '8px' }}
          >
            🚜 Bulldoze
          </button>

          <div style={{ height: '30px', width: '2px', background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />

          <button onClick={saveToDB} title="Save to DB" style={{ padding: '8px 16px', cursor: 'pointer', border: 'none', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>💾 Save</button>
          <button onClick={loadFromDB} title="Load from DB" style={{ padding: '8px 16px', cursor: 'pointer', border: 'none', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>📂 Load</button>
        </div>
      </div>
    </>
  );
}
