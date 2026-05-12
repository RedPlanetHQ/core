import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";

const GRID = 18;
const CELL_COUNT = GRID * GRID;
const CELL = 9;
const GAP = 3;
const TICK_MS = 70;
export const FLICKER_GRID_SIZE = GRID * CELL + (GRID - 1) * GAP;

const ACTIVE_FLICKER_CHANCE = 0.85;
const ACTIVE_MAX_OPACITY = 0.95;
const IDLE_FLICKER_CHANCE = 0.35;
const IDLE_MAX_OPACITY = 0.4;

const PRIMARY = "#1F88F5";

type Props = {
  active: boolean;
};

/**
 * Flickering cell grid with continuous opacity variation. Mirrors the canvas
 * `FlickeringGrid` in apps/webapp/app/routes/voice-widget.tsx — same
 * `flickerChance` / `maxOpacity` semantics, but rendered as Views (no Skia).
 *
 * - Each cell has a static "weight" (0.5..1.0) baked at mount so the pattern
 *   has texture instead of being uniform random noise.
 * - When active, the whole grid scales-pulses (1.0 → 1.03) on a 2.4s loop and
 *   gets a soft primary halo via iOS shadow.
 * - Each tick, every cell rolls flickerChance to receive a fresh random
 *   opacity in [0, maxOpacity * weight].
 */
export function FlickerGrid({ active }: Props) {
  const opacityRef = useRef<number[]>(new Array(CELL_COUNT).fill(0));
  const weightsRef = useRef<number[]>(
    Array.from({ length: CELL_COUNT }, () => 0.55 + Math.random() * 0.45),
  );
  const [, setTick] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      const ops = opacityRef.current;
      const weights = weightsRef.current;
      const chance = active ? ACTIVE_FLICKER_CHANCE : IDLE_FLICKER_CHANCE;
      const maxOp = active ? ACTIVE_MAX_OPACITY : IDLE_MAX_OPACITY;
      for (let i = 0; i < ops.length; i++) {
        if (Math.random() < chance) ops[i] = Math.random() * maxOp * weights[i];
      }
      setTick((t) => t + 1);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [active, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const cellClass = active ? "bg-primary" : "bg-foreground";

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    cells.push(
      <View
        key={i}
        className={cellClass}
        style={{
          width: CELL,
          height: CELL,
          borderRadius: 1.5,
          opacity: opacityRef.current[i],
        }}
      />,
    );
  }

  return (
    <Animated.View
      style={{
        transform: [{ scale }],
        shadowColor: PRIMARY,
        shadowOpacity: active ? 0.55 : 0,
        shadowRadius: 36,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <View
        className="flex-row flex-wrap"
        style={{
          width: FLICKER_GRID_SIZE,
          height: FLICKER_GRID_SIZE,
          gap: GAP,
        }}
      >
        {cells}
      </View>
    </Animated.View>
  );
}
