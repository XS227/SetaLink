import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp }   from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp }   from '@react-navigation/native';

export type RootStackParamList = {
  Splash:        undefined;
  Language:      undefined;
  Onboarding:    undefined;
  Auth:          undefined;
  Welcome:       undefined;
  Main:          undefined;
  Settings:      undefined;
  Diagnostics:   undefined;
  BypassApps:    undefined;
  TrustAiLink:   undefined;
  Upgrade:       undefined;
  Inbox:         undefined;
  Transfer:      undefined;
  Starlink:      undefined;
  Chapters:      undefined;
  ChapterDetail: { slug: string };
  Heroes:        { slug?: string } | undefined;
  ClanBrowse:    undefined;
  Social:        undefined;
  ShahnamehHome: undefined;
  Earn:          undefined;
  LiveTv:        undefined;
  LiveTvPlayer:  { channelId: string; channelIds: string[] };
};

export type MainTabParamList = {
  Home:     undefined;
  Servers:  undefined;
  AI:       undefined;
  Activity: undefined;
  Profile:  undefined;
  Game:     undefined;
  Chats:    undefined;
  Wallet:   undefined;
  Clan:     undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export type MainTabNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
