import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useConvexConnectionState } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Wrench, Gauge, Wifi, WifiOff, Clock, Menu, X, Activity } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString(undefined, {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}
      className="font-digital"
    >
      <Clock size={12} style={{ color: 'var(--f1-cyan)' }} />
      <span>{time || '00:00:00'}</span>
      <span style={{ fontSize: '9px', opacity: 0.6, letterSpacing: '0.1em' }}>LOCAL</span>
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
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(0, 230, 118, 0.08)',
          border: '1px solid rgba(0, 230, 118, 0.25)',
          color: 'var(--f1-green)',
          fontSize: '10px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--f1-green)',
            boxShadow: '0 0 8px var(--f1-green)',
          }}
          className="pulse-glow"
        />
        <Wifi size={11} /> LIVE TELEMETRY
      </div>
    );
  }

  return (
    <div
      title="Brak połączenia z Convex - telemetria w trybie offline"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(245, 158, 11, 0.1)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        color: 'var(--f1-yellow)',
        fontSize: '10px',
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      <WifiOff size={11} />
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--f1-yellow)',
        }}
      />
      {hasEverConnected ? 'SYNCHRONIZACJA...' : 'OFFLINE'}
    </div>
  );
}

export default function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { path: '/control', label: 'Race Control', icon: Radio, accent: 'var(--f1-cyan)' },
    { path: '/setup', label: 'Creator', icon: Wrench, accent: 'var(--f1-green)' },
    { path: '/race', label: 'Cockpit HUD', icon: Gauge, accent: 'var(--f1-red)' },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        background: 'rgba(5, 6, 8, 0.88)',
        borderBottom: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          maxWidth: '1440px',
          margin: '0 auto',
        }}
      >
        {/* Brand / Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <NavLink
            to="/control"
            style={{
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #f43f5e 0%, #00f0ff 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 16px rgba(0, 240, 255, 0.35)',
              }}
            >
              <Activity size={18} color="#050608" strokeWidth={2.8} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: '16px',
                  letterSpacing: '0.1em',
                  lineHeight: 1.1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span style={{ color: 'var(--f1-cyan)', textShadow: '0 0 14px rgba(0,240,255,0.5)' }}>
                  FLIGHT
                </span>
                <span>DRIVING</span>
              </div>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                FIA Telemetry Suite
              </span>
            </div>
          </NavLink>

          <div className="desktop-only" style={{ marginLeft: '6px' }}>
            <ConnectionStatus />
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav
          className="desktop-only"
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '4px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
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
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  borderRadius: 'var(--radius-sm)',
                  transition: 'color 0.15s ease',
                  zIndex: 1,
                }}
              >
                <Icon
                  size={14}
                  style={{
                    color: isActive ? item.accent : 'inherit',
                    filter: isActive ? `drop-shadow(0 0 6px ${item.accent})` : 'none',
                  }}
                />
                <span>{item.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="headerActivePill"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255, 255, 255, 0.07)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
                      borderRadius: 'var(--radius-sm)',
                      zIndex: -1,
                    }}
                    transition={{ type: 'spring', stiffness: 350, damping: 28 }}
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

        {/* Mobile Header Bar */}
        <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ConnectionStatus />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              background: mobileMenuOpen ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${mobileMenuOpen ? 'var(--f1-red)' : 'var(--border-subtle)'}`,
              color: mobileMenuOpen ? 'var(--f1-red)' : '#fff',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
            }}
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mobile-only"
            style={{
              overflow: 'hidden',
              background: 'rgba(9, 11, 17, 0.98)',
              borderTop: '1px solid var(--border-subtle)',
              borderBottom: '2px solid var(--f1-cyan)',
              backdropFilter: 'blur(24px)',
            }}
          >
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                  }}
                >
                  FIA RACING NAVIGATION
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
                      borderRadius: 'var(--radius-md)',
                      background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${isActive ? item.accent : 'var(--border-subtle)'}`,
                      color: isActive ? '#ffffff' : 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontWeight: 800,
                      fontSize: '13px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: 'var(--radius-xs)',
                        background: isActive ? item.accent : 'rgba(255,255,255,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isActive ? '#050608' : 'inherit',
                      }}
                    >
                      <Icon size={16} />
                    </div>
                    <span>{item.label}</span>
                    {isActive && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: '11px',
                          color: item.accent,
                          fontWeight: 800,
                        }}
                      >
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
