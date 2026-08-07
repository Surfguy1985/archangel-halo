import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { setBaseUrl, useGetPortal, getGetPortalQueryKey } from '@workspace/api-client-react';
import type { PortalBundle } from '@workspace/api-client-react';
import * as Linking from 'expo-linking';

const TOKEN_KEY = 'halo_crew_token';

// Set API base URL from env (outside component so it runs once at module load)
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

type AuthContextValue = {
  token: string | null;
  setToken: (token: string | null) => Promise<void>;
  portal: PortalBundle | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  invalidate: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  token: null,
  setToken: async () => {},
  portal: null,
  isLoading: true,
  isAuthenticated: false,
  invalidate: () => {},
});

function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = Linking.parse(url);
    // Try query param first: ?token=XXX
    if (parsed.queryParams?.token) {
      return parsed.queryParams.token as string;
    }
    // Try path: /portal/TOKEN
    const pathParts = (parsed.path || '').split('/').filter(Boolean);
    const portalIdx = pathParts.indexOf('portal');
    if (portalIdx >= 0 && pathParts[portalIdx + 1]) {
      return pathParts[portalIdx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const queryClient = useQueryClient();

  // Load persisted token on mount
  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then((stored) => {
        if (stored) setTokenState(stored);
      })
      .finally(() => setHydrated(true));
  }, []);

  // Handle deep links
  useEffect(() => {
    const handleUrl = (url: string) => {
      const t = extractTokenFromUrl(url);
      if (t) setToken(t);
    };

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setToken = useCallback(
    async (t: string | null) => {
      setTokenState(t);
      if (t) {
        await AsyncStorage.setItem(TOKEN_KEY, t);
      } else {
        await AsyncStorage.removeItem(TOKEN_KEY);
        queryClient.clear();
      }
    },
    [queryClient],
  );

  const { data: portal, isLoading: portalLoading } = useGetPortal(token!, {
    query: {
      enabled: !!token && hydrated,
      // Never retry on 4xx — a 404 means invalid token, retrying just delays
      // the error feedback and wastes a request.
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
      queryKey: getGetPortalQueryKey(token!),
    },
  });

  const isLoading = !hydrated || (!!token && portalLoading && !portal);

  const invalidate = useCallback(() => {
    if (token) {
      queryClient.invalidateQueries({
        queryKey: [`/api/portal/${token}`],
      });
    }
  }, [token, queryClient]);

  return (
    <AuthContext.Provider
      value={{
        token,
        setToken,
        portal: portal ?? null,
        isLoading,
        isAuthenticated: !!token && !!portal,
        invalidate,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
