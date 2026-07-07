import { useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';

export function useGreeting(): { greeting: string; name: string } {
  const name = useAuthStore((s) => s.user?.userId ?? '');

  // Returns an i18n key; the caller translates it so the greeting follows the
  // selected language.
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'greet.morning';
    if (h < 18) return 'greet.afternoon';
    return 'greet.evening';
  }, []);

  return { greeting, name };
}
