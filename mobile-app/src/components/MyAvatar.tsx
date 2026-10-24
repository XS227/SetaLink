import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import UserAvatar from './UserAvatar';
import { useIdentityStore } from '../stores/identityStore';
import { useAuthStore } from '../stores/authStore';
import { useProfilePicStore } from '../stores/profilePicStore';

/** The signed-in user's own avatar (photo → picked emoji → King/Queen portrait). */
export default function MyAvatar({ size = 44, photoUrl, style }: {
  size?: number; photoUrl?: string; style?: StyleProp<ViewStyle>;
}) {
  const persona     = useIdentityStore((s) => s.persona);
  const avatarEmoji = useIdentityStore((s) => s.avatarEmoji);
  const avatarColor = useIdentityStore((s) => s.avatarColor);
  const avatarMode  = useIdentityStore((s) => s.avatarMode);
  const handle      = useIdentityStore((s) => s.handle);
  const deviceId    = useAuthStore((s) => s.user?.deviceId) ?? '';
  const storePic    = useProfilePicStore((s) => s.url);
  return (
    <UserAvatar
      seedId={deviceId || handle || 'me'}
      persona={persona}
      emoji={avatarEmoji}
      color={avatarColor}
      useEmoji={avatarMode === 'emoji'}
      photoUrl={photoUrl || storePic || undefined}
      label={handle ?? ''}
      size={size}
      style={style}
    />
  );
}
