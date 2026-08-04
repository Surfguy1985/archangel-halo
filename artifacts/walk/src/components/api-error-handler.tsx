import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth-provider';

// This is a wrapper component that intercepts API errors and sets unauth state
export function ApiErrorHandler({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { checkAuth } = useAuth();

  useEffect(() => {
    // We can't globally intercept fetch here easily without service workers or patching fetch
    // But we can listen to react-query errors
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        const error = event.action.error as any;
        if (error?.status === 401 || error?.response?.status === 401) {
          checkAuth();
        }
      }
    });
    
    return () => unsubscribe();
  }, [queryClient, checkAuth]);

  return <>{children}</>;
}
