import { useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';

export function useGreeting(): { greeting: string; name: string } {
  const name = useAuthStore((s) => s.user?.name ?? '');

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return { greeting, name };
}
