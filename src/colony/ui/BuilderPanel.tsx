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
        background: 'rgba(20, 20, 24, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(8px)',
        padding: '12px 24px',
        borderRadius: '12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        zIndex: 1000,
        pointerEvents: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
      }}>
        <button 
          className={builderMode === 'roads' ? 'on' : ''}
          onClick={() => setBuilderMode('roads')}
          style={{ padding: '8px 16px', fontSize: '1.1em' }}
        >
          🛣️ Roads
        </button>
        <button 
          className={builderMode === 'raise' ? 'on' : ''}
          onClick={() => setBuilderMode('raise')}
          style={{ padding: '8px 16px', fontSize: '1.1em' }}
        >
          🏔️ Raise
        </button>
        <button 
          className={builderMode === 'lower' ? 'on' : ''}
          onClick={() => setBuilderMode('lower')}
          style={{ padding: '8px 16px', fontSize: '1.1em' }}
        >
          🕳️ Lower
        </button>
        <button 
          className={builderMode === 'flatten' ? 'on' : ''}
          onClick={() => setBuilderMode('flatten')}
          style={{ padding: '8px 16px', fontSize: '1.1em' }}
        >
          ➖ Flatten
        </button>

        <div style={{ height: '30px', width: '2px', background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />

        <button onClick={saveToDB} title="Save Terraforming to DB" style={{ padding: '8px 16px' }}>💾 Save</button>
        <button onClick={loadFromDB} title="Load Terraforming from DB" style={{ padding: '8px 16px' }}>📂 Load</button>
      </div>
    </>
  );
}
