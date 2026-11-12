import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const PREVIEW_OCCUPIED_COUNT = 22;
const PREVIEW_TOTAL_BAYS = 40;

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@apex-wms.com');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message || 'Check your email and password and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectFacilityPass = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div className="login-gate">
      <div className="login-sheet corner-frame">
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />

        {/* Left Steel Schematic Column */}
        <div className="login-schematic-col">
          <div className="brand-mark-row">
            <span className="yard-mark">YL</span>
            <span className="brand-wordmark">Yardline WMS</span>
          </div>

          <div className="schematic-copy">
            <h1>Floor-level visibility for every bay, pallet, and dock door.</h1>
            <p>
              Sign in with your company account to check live rack occupancy, switch between
              regional warehouses, and review receiving and dispatch logs.
            </p>
          </div>

          <div className="login-bay-preview">
            <div className="login-bay-caption">
              <span>TLV-01 bay sample</span>
              <span>54% occupied</span>
            </div>
            <div className="login-bay-strip" aria-hidden="true">
              {Array.from({ length: PREVIEW_TOTAL_BAYS }).map((_, idx) => (
                <span
                  key={idx}
                  className={`mini-bay ${idx < PREVIEW_OCCUPIED_COUNT ? 'filled' : ''}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right Sign-In Column */}
        <div className="login-form-col">
          <div className="login-form-header">
            <h2>Operator sign in</h2>
            <p>Enter your company credentials to open your warehouse workspace.</p>
          </div>

          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="gate-form">
            <div className="field-row">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
              />
            </div>

            <div className="field-row">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </div>

            <button type="submit" className="gate-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Opening workspace...' : 'Open warehouse workspace'}
            </button>
          </form>

          <div className="facility-passes">
            <div className="passes-heading">Test accounts</div>
            <div className="passes-list">
              <button
                type="button"
                className={`pass-btn ${email === 'admin@apex-wms.com' ? 'selected' : ''}`}
                onClick={() => selectFacilityPass('admin@apex-wms.com', 'Admin123!')}
              >
                <div className="pass-left">
                  <span className="pass-code">APEX</span>
                  <span className="pass-company">Apex Global Logistics</span>
                </div>
                <span className="pass-meta">3 sites (54%, 85%, 30%)</span>
              </button>

              <button
                type="button"
                className={`pass-btn ${email === 'demo@novaretail.com' ? 'selected' : ''}`}
                onClick={() => selectFacilityPass('demo@novaretail.com', 'Demo123!')}
              >
                <div className="pass-left">
                  <span className="pass-code">NOVA</span>
                  <span className="pass-company">Nova Retail Group</span>
                </div>
                <span className="pass-meta">2 sites (62%, 91.7%)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
