import { Pressable, StyleSheet, Text, View } from "react-native";

import { isSameDay, isToday } from "../lib/dates";
import { useTheme } from "../theme";

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // JS getDay(): 0 = Sun .. 6 = Sat. We want Monday = 0.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

export function buildWeekDates(reference: Date): Date[] {
  const start = startOfWeekMonday(reference);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function WeekStrip({
  selected,
  onSelect,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
}) {
  const theme = useTheme();
  const days = buildWeekDates(selected);

  return (
    <View style={styles.row}>
      {days.map((day, i) => {
        const isSelected = isSameDay(day, selected);
        const today = isToday(day);

        // Day-of-week label colour: selected day uses primary, others muted.
        const labelColor = isSelected
          ? theme.colors.primary
          : theme.colors.mutedForeground;

        // Date number: selected day shows white-on-primary disc, others
        // show plain foreground. Today (when not selected) gets a primary
        // ring instead of a fill.
        return (
          <Pressable
            key={day.toISOString()}
            onPress={() => onSelect(day)}
            style={styles.dayCol}
            hitSlop={6}
          >
            <Text
              style={{
                fontFamily: theme.fontFamily.sansMedium,
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: labelColor,
                marginBottom: 6,
              }}
            >
              {SHORT_DAYS[i]}
            </Text>
            <View
              style={[
                styles.dateDisc,
                isSelected && {
                  backgroundColor: theme.colors.primary,
                },
                !isSelected &&
                  today && {
                    borderWidth: 1.5,
                    borderColor: theme.colors.primary,
                  },
              ]}
            >
              <Text
                style={{
                  fontFamily: theme.fontFamily.sansSemibold,
                  fontSize: 15,
                  color: isSelected
                    ? theme.colors.primaryForeground
                    : today
                      ? theme.colors.primary
                      : theme.colors.foreground,
                }}
              >
                {day.getDate()}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  dayCol: {
    flex: 1,
    alignItems: "center",
  },
  dateDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
