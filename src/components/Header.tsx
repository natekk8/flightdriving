import { NavLink } from 'react-router-dom';

export default function Header() {
  return (
    <header style={{ 
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
      padding: '16px 24px', background: '#0a0a0c', borderBottom: '1px solid #222' 
    }}>
      <div style={{ color: 'white', fontWeight: 900, fontSize: '18px', letterSpacing: '2px' }}>
        <span style={{ color: 'var(--neon-green)' }}>FLIGHT</span> DRIVING
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
