import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useConvexConnectionState } from 'convex/react';
import { motion } from 'framer-motion';
import { Radio, Wrench, Gauge, Wifi, WifiOff, Clock } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('pl-PL', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 12px', borderRadius: '10px',
      background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#a0a0b8', fontSize: '12px', fontWeight: 600, letterSpacing: '1px'
    }} className="font-digital">
      <Clock size={13} style={{ color: 'var(--neon-cyan)' }} />
      <span>{time || '00:00:00'} UTC</span>
    </div>
  );
}

function ConnectionStatus() {
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState();

  if (isWebSocketConnected) {
    return (
      <div
        title="Połączono z serwerem telemetrii Convex"
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', borderRadius: '10px',
          background: 'rgba(57, 255, 20, 0.1)', border: '1px solid rgba(57, 255, 20, 0.3)',
          color: 'var(--neon-green)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.8px'
        }}
      >
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%', background: 'var(--neon-green)',
          boxShadow: '0 0 8px var(--neon-green)', animation: 'pulse 1.5s infinite'
        }} />
        <Wifi size={12} /> LIVE SYNC
      </div>
    );
  }

  return (
    <div
      title="Brak połączenia z serwerem Convex - dane telemetryczne będą synchronizowane po wznowieniu sygnału."
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '10px',
        background: 'rgba(255, 145, 0, 0.15)', border: '1px solid var(--neon-orange)',
        color: 'var(--neon-orange)', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.8px'
      }}
    >
      <WifiOff size={12} />
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--neon-orange)' }} />
      {hasEverConnected ? 'Łączenie...' : 'Brak połączenia'}
    </div>
  );
}

export default function Header() {
  const location = useLocation();

  const navItems = [
    { path: '/control', label: 'Race Control', icon: Radio, accent: 'var(--neon-cyan)' },
    { path: '/setup', label: 'Creator', icon: Wrench, accent: 'var(--neon-green)' },
    { path: '/race', label: 'Cockpit', icon: Gauge, accent: 'var(--f1-red)' }
  ];

  return (
    <header style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 28px', background: 'rgba(7, 7, 10, 0.92)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(20px)', position: 'sticky', top: 0, zIndex: 1000
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #e10600 0%, #ff3b30 100%)',
            color: '#fff', fontSize: '11px', fontWeight: 900, padding: '3px 7px',
            borderRadius: '4px', transform: 'skew(-12deg)', letterSpacing: '1px',
            boxShadow: '0 0 12px rgba(225, 6, 0, 0.6)'
          }}>
            F1 PIT
          </div>
          <div style={{ color: 'white', fontWeight: 900, fontSize: '19px', letterSpacing: '2px', fontFamily: 'Outfit' }}>
            <span style={{ color: 'var(--neon-cyan)', textShadow: '0 0 15px rgba(0,240,255,0.4)' }}>FLIGHT</span> DRIVING
          </div>
        </div>
        <ConnectionStatus />
      </div>

      <nav style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '13px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                transition: 'color 0.2s ease'
              }}
            >
              <Icon size={16} style={{ color: isActive ? item.accent : 'inherit' }} />
              <span>{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="headerActiveTab"
                  style={{
                    position: 'absolute',
                    bottom: '-12px',
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: item.accent,
                    boxShadow: `0 0 12px ${item.accent}`,
                    borderRadius: '3px 3px 0 0'
                  }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <LiveClock />
      </div>
    </header>
  );
}

