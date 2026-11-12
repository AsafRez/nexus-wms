import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Bot, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWarehouse } from '../../context/WarehouseContext';
import { AiCopilotModal } from '../ai/AiCopilotModal';

export const AppShell: React.FC = () => {
  const { user, logout } = useAuth();
  const { warehouses, selectedWarehouse, selectWarehouse } = useWarehouse();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const navItems = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/locations', label: 'Locations', end: false },
    { to: '/inventory', label: 'Inventory', end: false },
    { to: '/inbound', label: 'Inbound', end: false },
    { to: '/outbound', label: 'Outbound', end: false },
  ];

  return (
    <div className="app-shell">
      <header className="control-header">
        <div className="content-container control-top-row">
          <div className="identity-cluster">
            <div className="brand-mark-row">
              <span className="yard-mark">YL</span>
              <span className="brand-wordmark">Yardline</span>
            </div>
            <span className="identity-divider" aria-hidden="true" />
            <span className="tenant-name">{user?.business.name}</span>
          </div>

          {/* Warehouse Switcher Dropdown */}
          <div className="facility-selector" ref={dropdownRef}>
            <span className="selector-label">Warehouse</span>
            <button
              type="button"
              className="selector-button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
            >
              {selectedWarehouse ? (
                <>
                  <span className="selector-left">
                    <span className="site-code">{selectedWarehouse.code}</span>
                    <span className="selector-name">{selectedWarehouse.name}</span>
                    <span className="selector-city">{selectedWarehouse.city}</span>
                  </span>
                  <span className="selector-right">
                    <span className="switcher-pct">
                      {selectedWarehouse.occupancyPercentage}%
                    </span>
                    <ChevronDown
                      size={15}
                      className={`caret-icon ${dropdownOpen ? 'open' : ''}`}
                    />
                  </span>
                </>
              ) : (
                <span>Loading facilities...</span>
              )}
            </button>

            {dropdownOpen && (
              <div className="selector-dropdown" role="listbox">
                <div className="dropdown-head">
                  Switch facility ({warehouses.length} in {user?.business.name})
                </div>
                {warehouses.map((wh) => {
                  const isSelected = wh.id === selectedWarehouse?.id;
                  return (
                    <button
                      key={wh.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`dropdown-item ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        selectWarehouse(wh.id);
                        setDropdownOpen(false);
                      }}
                    >
                      <div>
                        <div className="dropdown-item-title">
                          <span className="site-code light">{wh.code}</span>
                          <span>{wh.name}</span>
                        </div>
                        <div className="dropdown-item-sub">
                          {wh.city}, {wh.typeDisplayName.toLowerCase()} ({wh.usedCapacity}/
                          {wh.totalCapacity} places)
                        </div>
                      </div>
                      <span className={`tone-tag ${wh.statusBadgeInfo.toneClass} tabular`}>
                        {wh.formattedFullLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="operator-cluster">
            <span className="operator-name">{user?.fullName}</span>
            <button type="button" className="signout-btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <nav className="section-nav" aria-label="Warehouse sections">
        <div className="content-container section-nav-inner">
          <div className="nav-tabs">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </div>

          {selectedWarehouse && (
            <div className="facility-address-note">
              {selectedWarehouse.address}, {selectedWarehouse.city}
            </div>
          )}
        </div>
      </nav>

      <main className="container-lines">
        <div className="content-container workspace-body">
          <Outlet />
        </div>
      </main>

      {/* Right-Side Floating Helper Boxiy Bubble */}
      {selectedWarehouse && (
        <>
          <button
            type="button"
            className="ai-floating-bubble"
            aria-label="Open Helper Boxiy"
            onClick={() => setIsAiModalOpen(true)}
          >
            <span className="ai-bubble-icon">
              <Bot size={20} />
            </span>
            <span className="ai-bubble-label">Helper Boxiy</span>
          </button>

          <AiCopilotModal
            isOpen={isAiModalOpen}
            onClose={() => setIsAiModalOpen(false)}
          />
        </>
      )}
    </div>
  );
};
