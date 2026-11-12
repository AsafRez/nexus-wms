import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserProfileDto } from '../../../shared/wms.contracts';
import { authApiService } from '../services/AuthApiService';

interface AuthContextValue {
  user: UserProfileDto | null;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  useEffect(() => {
    const restoreSession = async () => {
      if (!authApiService.hasStoredToken()) {
        setIsInitializing(false);
        return;
      }
      try {
        const profile = await authApiService.getCurrentUser();
        setUser(profile);
      } catch {
        authApiService.logout();
        setUser(null);
      } finally {
        setIsInitializing(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApiService.login(email, password);
    setUser(response.user);
  };

  const logout = () => {
    authApiService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}

