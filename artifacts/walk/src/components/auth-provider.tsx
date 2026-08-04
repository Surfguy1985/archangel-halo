import React, { createContext, useContext, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (passcode: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  checkAuth: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Module-level hook so the query client (created outside React) can kick the
// app back to the lock screen on any 401.
let unauthorizedHandler: () => void = () => {};
export function notifyUnauthorized() {
  unauthorizedHandler();
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true); // Optimistic initially
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    unauthorizedHandler = () => setIsAuthenticated(false);
    // We check if cookie exists loosely by making a simple request, or just wait for the first 401
    setIsChecking(false);
    return () => {
      unauthorizedHandler = () => {};
    };
  }, []);

  const login = async (passcode: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/office-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        queryClient.invalidateQueries();
      } else {
        throw new Error('Invalid passcode');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
  };

  const checkAuth = () => {
    // Expose for query clients to call on 401
    setIsAuthenticated(false);
  };

  if (isChecking) return <div className="flex h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, isLoading, checkAuth }}>
      {isAuthenticated ? children : <LoginScreen />}
    </AuthContext.Provider>
  );
};

function LoginScreen() {
  const { login, isLoading } = useAuth();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(passcode);
    } catch (err) {
      setError('Invalid passcode');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">HALO Walk</h1>
          <p className="text-muted-foreground">Enter passcode to access field tools</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Passcode"
              className="h-16 text-center text-3xl font-mono shadow-sm"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              data-testid="input-passcode"
              autoFocus
            />
            {error && <p className="text-destructive text-center text-sm font-medium">{error}</p>}
          </div>
          
          <Button 
            type="submit" 
            className="w-full h-16 text-xl font-bold rounded-xl shadow-md"
            disabled={isLoading || passcode.length < 4}
          >
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Enter'}
          </Button>
        </form>
      </div>
    </div>
  );
}
