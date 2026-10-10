import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getCurrentAccount,
  getFriendlyAuthError,
  signOut,
  subscribeToAuthChanges,
  type Account,
} from '../services/authService';

interface AuthContextValue {
  account: Account | null;
  isLoading: boolean;
  error: string | null;
  refreshAccount: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [account, setAccount] = useState<Account | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      setError(null);
      const nextAccount = await getCurrentAccount();
      setAccount(nextAccount);
    } catch (refreshError) {
      // Keep a valid signed-in account available during temporary network errors.
      setError(getFriendlyAuthError(refreshError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitialAccount = async () => {
      try {
        const nextAccount = await getCurrentAccount();
        if (cancelled) {
          return;
        }
        setError(null);
        setAccount(nextAccount);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setAccount(null);
        setError(getFriendlyAuthError(loadError));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialAccount();

    const unsubscribe = subscribeToAuthChanges(() => void refreshAccount());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshAccount]);

  const logout = useCallback(async () => {
    await signOut();
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({ account, isLoading, error, refreshAccount, logout }),
    [account, error, isLoading, logout, refreshAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
