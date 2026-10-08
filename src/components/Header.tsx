import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useConvexConnectionState } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gauge, Map, BarChart3, Wifi, WifiOff, Clock, Menu, X } from 'lucide-react';

function LiveClock() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const update = () => {
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
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="font-digital"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        fontSize: '12px',
        fontWeight: 500,
      }}
    >
      <Clock size={13} style={{ color: 'var(--text-muted)' }} />
      <span>{time || '00:00:00'}</span>
    </div>
  );
}

function ConnectionIndicator() {
  const { isWebSocketConnected } = useConvexConnectionState();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px',
        borderRadius: 'var(--radius-sm)',
        background: isWebSocketConnected ? 'var(--accent-green-bg)' : 'var(--accent-amber-bg)',
        border: `1px solid ${isWebSocketConnected ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
        color: isWebSocketConnected ? 'var(--accent-green)' : 'var(--accent-amber)',
        fontSize: '11px',
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: isWebSocketConnected ? 'var(--accent-green)' : 'var(--accent-amber)',
        }}
      />
      {isWebSocketConnected ? (
        <>
          <Wifi size={12} />
          <span>Połączono</span>
        </>
      ) : (
        <>
          <WifiOff size={12} />
          <span>Offline</span>
        </>
      )}
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
    { path: '/race', label: 'Kokpit', icon: Gauge },
    { path: '/setup', label: 'Kreator', icon: Map },
    { path: '/control', label: 'Panel', icon: BarChart3 },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        background: 'rgba(9, 10, 15, 0.85)',
        borderBottom: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 20px',
          maxWidth: '1280px',
          margin: '0 auto',
        }}
      >
        {/* Brand */}
        <NavLink
          to="/race"
          style={{
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: 'var(--text-main)',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-green)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#090a0f',
            }}
          >
            <Gauge size={16} strokeWidth={2.5} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              FlightDriving
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500 }}>
              Pomiar czasu & telemetria
            </span>
          </div>
        </NavLink>

        {/* Desktop Navigation */}
        <nav
          className="desktop-only"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '3px',
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
                  gap: '6px',
                  padding: '7px 14px',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  textDecoration: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  transition: 'color 0.15s ease',
                  zIndex: 1,
                }}
              >
                <Icon size={14} style={{ color: isActive ? 'var(--accent-green)' : 'inherit' }} />
                <span>{item.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="headerActivePill"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      zIndex: -1,
                    }}
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  />
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Status + Clock */}
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ConnectionIndicator />
          <LiveClock />
        </div>

        {/* Mobile Toggle */}
        <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ConnectionIndicator />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
            }}
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="mobile-only"
            style={{
              overflow: 'hidden',
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                      gap: '10px',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--accent-green-bg)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(16, 185, 129, 0.3)' : 'transparent'}`,
                      color: isActive ? '#ffffff' : 'var(--text-secondary)',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    <Icon size={16} style={{ color: isActive ? 'var(--accent-green)' : 'inherit' }} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                <LiveClock />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
