import { NavLink } from 'react-router-dom';
import { useConvexConnectionState } from 'convex/react';

function ConnectionStatus() {
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState();

  if (isWebSocketConnected) return null;

  return (
    <div
      title="Brak połączenia z serwerem Convex - dane (czas, sektory, okrążenia) nie będą się synchronizować, dopóki połączenie nie zostanie przywrócone."
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '12px',
        background: 'rgba(255,145,0,0.15)', border: '1px solid var(--neon-orange)',
        color: 'var(--neon-orange)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
      }}
    >
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--neon-orange)' }} />
      {hasEverConnected ? 'Łączenie...' : 'Brak połączenia'}
    </div>
  );
}

export default function Header() {
  return (
    <header style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '16px 24px', background: '#0a0a0c', borderBottom: '1px solid #222'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ color: 'white', fontWeight: 900, fontSize: '18px', letterSpacing: '2px' }}>
          <span style={{ color: 'var(--neon-green)' }}>FLIGHT</span> DRIVING
        </div>
        <ConnectionStatus />
      </div>

      <nav style={{ display: 'flex', gap: '24px' }}>
        <NavLink
          to="/control"
          style={({ isActive }) => ({ color: isActive ? 'white' : 'var(--text-secondary)', textDecoration: 'none', fontWeight: 600, borderBottom: isActive ? '2px solid var(--neon-blue)' : 'none', paddingBottom: '4px' })}
        >
          Race Control
        </NavLink>
        <NavLink
          to="/setup"
          style={({ isActive }) => ({ color: isActive ? 'white' : 'var(--text-secondary)', textDecoration: 'none', fontWeight: 600, borderBottom: isActive ? '2px solid var(--neon-green)' : 'none', paddingBottom: '4px' })}
        >
          Creator
        </NavLink>
        <NavLink
          to="/race"
          style={({ isActive }) => ({ color: isActive ? 'white' : 'var(--text-secondary)', textDecoration: 'none', fontWeight: 600, borderBottom: isActive ? '2px solid var(--neon-red)' : 'none', paddingBottom: '4px' })}
        >
          Cockpit
        </NavLink>
      </nav>
    </header>
  );
}
