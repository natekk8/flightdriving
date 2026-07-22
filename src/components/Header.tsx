import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useConvexConnectionState } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Wrench, Gauge, Wifi, WifiOff, Clock, Menu, X } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('pl-PL', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 10px', borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#a0a0b8', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px'
    }} className="font-digital">
      <Clock size={12} style={{ color: 'var(--neon-cyan)' }} />
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
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '3px 8px', borderRadius: '8px',
          background: 'rgba(57, 255, 20, 0.1)', border: '1px solid rgba(57, 255, 20, 0.3)',
          color: 'var(--neon-green)', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        <span style={{
          width: '5px', height: '5px', borderRadius: '50%', background: 'var(--neon-green)',
          boxShadow: '0 0 8px var(--neon-green)', animation: 'pulse 1.5s infinite'
        }} />
        <Wifi size={11} /> LIVE SYNC
      </div>
    );
  }

  return (
    <div
      title="Brak połączenia z serwerem Convex - dane telemetryczne będą synchronizowane po wznowieniu sygnału."
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '3px 8px', borderRadius: '8px',
        background: 'rgba(255, 145, 0, 0.15)', border: '1px solid var(--neon-orange)',
        color: 'var(--neon-orange)', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}
    >
      <WifiOff size={11} />
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--neon-orange)' }} />
      {hasEverConnected ? 'Łączenie...' : 'Brak sygnału'}
    </div>
  );
}

export default function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auto close menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { path: '/control', label: 'Race Control', icon: Radio, accent: 'var(--neon-cyan)' },
    { path: '/setup', label: 'Creator', icon: Wrench, accent: 'var(--neon-green)' },
    { path: '/race', label: 'Cockpit', icon: Gauge, accent: 'var(--f1-red)' }
  ];

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 1000,
      background: 'rgba(7, 7, 10, 0.95)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(20px)'
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', maxWidth: '1400px', margin: '0 auto'
      }}>
        {/* Brand / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              background: 'linear-gradient(135deg, #e10600 0%, #ff3b30 100%)',
              color: '#fff', fontSize: '10px', fontWeight: 900, padding: '2px 6px',
              borderRadius: '4px', transform: 'skew(-12deg)', letterSpacing: '1px',
              boxShadow: '0 0 12px rgba(225, 6, 0, 0.6)'
            }}>
              F1 PIT
            </div>
            <div style={{ color: 'white', fontWeight: 900, fontSize: '17px', letterSpacing: '1.5px', fontFamily: 'Outfit' }}>
              <span style={{ color: 'var(--neon-cyan)', textShadow: '0 0 15px rgba(0,240,255,0.4)' }}>FLIGHT</span> DRIVING
            </div>
          </div>
          <div className="desktop-only">
            <ConnectionStatus />
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="desktop-only" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                  gap: '6px',
                  padding: '6px 14px',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  transition: 'color 0.2s ease'
                }}
              >
                <Icon size={14} style={{ color: isActive ? item.accent : 'inherit' }} />
                <span>{item.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="headerActiveTab"
                    style={{
                      position: 'absolute',
                      bottom: '-10px',
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

        {/* Desktop Clock */}
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LiveClock />
        </div>

        {/* Mobile Header Right Bar (Status + Clock + Burger Toggle Button) */}
        <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ConnectionStatus />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              background: mobileMenuOpen ? 'rgba(243, 18, 60, 0.2)' : 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${mobileMenuOpen ? 'var(--neon-red)' : 'rgba(255, 255, 255, 0.15)'}`,
              color: mobileMenuOpen ? 'var(--neon-red)' : '#fff',
              padding: '6px 10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label="Menu nawigacyjne"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Animated Dropdown Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="mobile-only"
            style={{
              overflow: 'hidden',
              background: 'rgba(10, 11, 16, 0.98)',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              borderBottom: '2px solid var(--f1-red)',
              backdropFilter: 'blur(25px)'
            }}
          >
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '1px' }}>
                  F1 NAVIGATION MENU
                </span>
                <LiveClock />
              </div>

              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <NavLink
                    key={`mobile-${item.path}`}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      borderRadius: '12px',
                      background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${isActive ? item.accent : 'rgba(255, 255, 255, 0.06)'}`,
                      color: isActive ? '#ffffff' : 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontWeight: 800,
                      fontSize: '14px',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}
                  >
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: isActive ? item.accent : 'rgba(255,255,255,0.05)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: isActive ? '#000' : 'inherit'
                    }}>
                      <Icon size={18} />
                    </div>
                    <span>{item.label}</span>
                    {isActive && (
                      <span style={{ marginLeft: 'auto', fontSize: '11px', color: item.accent, fontWeight: 900 }}>
                        ● ACTIVE
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}


