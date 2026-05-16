import React, { useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withSpring,
} from 'react-native-reanimated';
import { Colors, Typography, Shadow, Animation } from '../design/tokens';
import { AnimatedRing } from './AnimatedRing';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

interface Props {
  state:    ConnectionState;
  onPress:  () => void;
  disabled?: boolean;
}

const SIZE = 188;

export function ConnectButton({ state, onPress, disabled = false }: Props) {
  const scale       = useSharedValue(1);
  const glowOpacity = useSharedValue(0);

  const isConnected  = state === 'connected';
  const isConnecting = state === 'connecting' || state === 'disconnecting';

  useEffect(() => {
    glowOpacity.value = withTiming(
      isConnected ? 1 : 0,
      { duration: isConnected ? Animation.duration.slow : Animation.duration.normal },
    );
  }, [isConnected]);

  const handlePressIn  = () => {
    scale.value = withTiming(0.93, { duration: Animation.duration.instant });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, Animation.spring.bouncy);
  };

  const buttonColor = isConnected ? Colors.emerald[400] : Colors.bg.elevated;
  const borderColor = isConnected ? Colors.emerald[400] : Colors.border.default;
  const labelText   = isConnecting ? '' : isConnected ? 'Disconnect' : 'Connect';

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value * 0.12,
  }));

  return (
    <View style={styles.wrapper}>
      {/* Ambient glow — opacity animated on UI thread */}
      <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />

      {/* Pulse rings — mounted only when connected (avoids idle workloads) */}
      {isConnected && (
        <>
          <AnimatedRing size={SIZE} pulsing delay={0}   initialOpacity={0.15} />
          <AnimatedRing size={SIZE} pulsing delay={400} initialOpacity={0.11} />
          <AnimatedRing size={SIZE} pulsing delay={800} initialOpacity={0.07} />
        </>
      )}

      <Pressable
        onPress={disabled ? undefined : onPress}
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        hitSlop={8}
      >
        <Animated.View
          style={[
            styles.button,
            { backgroundColor: buttonColor, borderColor },
            isConnected && Shadow.emerald,
            buttonStyle,
          ]}
        >
          <View style={[styles.innerRing, {
            borderColor: isConnected ? 'rgba(255,255,255,0.2)' : Colors.border.default,
          }]} />

          {isConnecting ? (
            <ActivityIndicator size="large" color={Colors.emerald[400]} />
          ) : (
            <>
              <View style={[styles.powerIcon, {
                borderColor: isConnected ? Colors.text.inverse : Colors.emerald[400],
              }]}>
                <View style={[styles.powerArc, {
                  borderColor: isConnected ? Colors.text.inverse : Colors.emerald[400],
                }]} />
                <View style={[styles.powerLine, {
                  backgroundColor: isConnected ? Colors.text.inverse : Colors.emerald[400],
                }]} />
              </View>
              <Text style={[styles.label, {
                color: isConnected ? Colors.text.inverse : Colors.text.secondary,
              }]}>
                {labelText}
              </Text>
            </>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width:           SIZE,
    height:          SIZE,
    alignItems:      'center',
    justifyContent:  'center',
  },
  glow: {
    position:        'absolute',
    width:           SIZE * 1.8,
    height:          SIZE * 1.8,
    borderRadius:    SIZE,
    backgroundColor: Colors.emerald[400],
  },
  button: {
    width:           SIZE,
    height:          SIZE,
    borderRadius:    SIZE,
    borderWidth:     1.5,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
  },
  innerRing: {
    position:        'absolute',
    width:           SIZE - 24,
    height:          SIZE - 24,
    borderRadius:    SIZE,
    borderWidth:     1,
  },
  powerIcon: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
  },
  powerArc: {
    width:            32,
    height:           32,
    borderRadius:     16,
    borderWidth:      3,
    borderBottomColor:'transparent',
    borderLeftColor:  'transparent',
    transform:        [{ rotate: '45deg' }],
    position:         'absolute',
  },
  powerLine: {
    width:            3,
    height:           14,
    borderRadius:     2,
    position:         'absolute',
    top:              0,
  },
  label: {
    fontSize:         Typography.size.sm,
    fontFamily:       Typography.family.label,
    letterSpacing:    Typography.tracking.wider,
    textTransform:    'uppercase',
    marginTop:        4,
  },
});
