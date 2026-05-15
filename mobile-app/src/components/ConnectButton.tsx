import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, Typography, Shadow, Animation } from '../design/tokens';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting';

interface Props {
  state: ConnectionState;
  onPress: () => void;
}

export function ConnectButton({ state, onPress }: Props) {
  const ring1 = useRef(new Animated.Value(1)).current;
  const ring2 = useRef(new Animated.Value(1)).current;
  const ring3 = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === 'connected') {
      // Breathing pulse rings when connected
      const pulse = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1.6,
              duration: 1800,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 1,
              duration: 1800,
              useNativeDriver: true,
            }),
          ])
        );

      pulse(ring1, 0).start();
      pulse(ring2, 400).start();
      pulse(ring3, 800).start();

      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: Animation.duration.slow,
        useNativeDriver: true,
      }).start();
    } else {
      ring1.setValue(1);
      ring2.setValue(1);
      ring3.setValue(1);
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: Animation.duration.normal,
        useNativeDriver: true,
      }).start();
    }
  }, [state]);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 0.93,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        ...Animation.spring.bouncy,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  const isConnected   = state === 'connected';
  const isConnecting  = state === 'connecting' || state === 'disconnecting';
  const buttonColor   = isConnected ? Colors.emerald[400] : Colors.bg.elevated;
  const borderColor   = isConnected ? Colors.emerald[400] : Colors.border.default;
  const labelText     = isConnecting ? ''
    : isConnected ? 'Disconnect'
    : 'Connect';

  return (
    <View style={styles.wrapper}>
      {/* Glow background */}
      <Animated.View
        style={[styles.glow, { opacity: glowOpacity }]}
        pointerEvents="none"
      />

      {/* Pulse rings (only when connected) */}
      {isConnected && [ring1, ring2, ring3].map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ring,
            {
              transform: [{ scale: anim }],
              opacity: anim.interpolate({
                inputRange: [1, 1.6],
                outputRange: [0.15 - i * 0.04, 0],
              }),
            },
          ]}
          pointerEvents="none"
        />
      ))}

      <TouchableOpacity onPress={handlePress} activeOpacity={1}>
        <Animated.View
          style={[
            styles.button,
            {
              backgroundColor: buttonColor,
              borderColor,
              transform: [{ scale }],
            },
            isConnected && Shadow.emerald,
          ]}
        >
          {/* Inner ring decoration */}
          <View style={[styles.innerRing, { borderColor: isConnected
            ? 'rgba(255,255,255,0.2)'
            : Colors.border.default }]}
          />

          {isConnecting ? (
            <ActivityIndicator
              size="large"
              color={Colors.emerald[400]}
            />
          ) : (
            <>
              {/* Power icon SVG-style via borders */}
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

              <Text style={[
                styles.label,
                { color: isConnected ? Colors.text.inverse : Colors.text.secondary },
              ]}>
                {labelText}
              </Text>
            </>
          )}
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const SIZE = 188;

const styles = StyleSheet.create({
  wrapper: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: SIZE * 1.8,
    height: SIZE * 1.8,
    borderRadius: SIZE,
    backgroundColor: Colors.emerald[400],
    opacity: 0,
  },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE,
    borderWidth: 1.5,
    borderColor: Colors.emerald[400],
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  innerRing: {
    position: 'absolute',
    width: SIZE - 24,
    height: SIZE - 24,
    borderRadius: SIZE,
    borderWidth: 1,
  },
  powerIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerArc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
  },
  powerLine: {
    width: 3,
    height: 14,
    borderRadius: 2,
    position: 'absolute',
    top: 0,
  },
  label: {
    fontSize: Typography.size.sm,
    fontFamily: Typography.family.label,
    letterSpacing: Typography.tracking.wider,
    textTransform: 'uppercase',
    marginTop: 4,
  },
});
