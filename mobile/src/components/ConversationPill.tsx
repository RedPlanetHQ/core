import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type Props = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Chat-bubble style display for a single conversation turn.
 *
 * User turns hug the right with a primary-tinted background; assistant turns
 * hug the left with an accent background. Width is capped so long replies
 * wrap inside the pill instead of expanding edge-to-edge.
 */
export function ConversationPill({ role, text }: Props) {
  const isUser = role === "user";
  return (
    <View
      className={cn(
        "w-full flex-row",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <View
        className={cn(
          "rounded-2xl px-4 py-2",
          isUser
            ? "bg-primary/15 border border-primary/30"
            : "bg-accent border border-border",
        )}
        style={{ maxWidth: "85%" }}
      >
        <Text
          className={cn(
            "text-sm leading-5",
            isUser ? "text-primary" : "text-foreground",
          )}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}
