import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WarehouseProvider } from './context/WarehouseContext';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { LocationsPage } from './pages/LocationsPage';
import { InventoryPage } from './pages/InventoryPage';
import { MovementsPage } from './pages/MovementsPage';

const AppRoutes: React.FC = () => {
  const { user, isInitializing } = useAuth();

  if (isInitializing) {
    return <div className="fullscreen-loader">Initializing NexusWMS Session...</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <WarehouseProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inbound" element={<MovementsPage movementType="INBOUND" />} />
          <Route path="/outbound" element={<MovementsPage movementType="OUTBOUND" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </WarehouseProvider>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
};

