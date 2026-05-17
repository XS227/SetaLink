import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp }   from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp }   from '@react-navigation/native';

export type RootStackParamList = {
  Splash:      undefined;
  Language:    undefined;
  Onboarding:  undefined;
  Auth:        undefined;
  Main:        undefined;
  Settings:    undefined;
  Diagnostics: undefined;
  Upgrade:     undefined;
};

export type MainTabParamList = {
  Home:     undefined;
  Servers:  undefined;
  AI:       undefined;
  Activity: undefined;
  Profile:  undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export type MainTabNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;
