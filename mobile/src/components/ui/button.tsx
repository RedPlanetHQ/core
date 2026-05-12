import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Pressable } from "react-native";

import { TextClassContext } from "./text";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group flex items-center justify-center rounded-md active:opacity-90",
  {
    variants: {
      variant: {
        default: "bg-primary",
        destructive: "bg-destructive",
        outline: "border border-border bg-background",
        secondary: "bg-secondary",
        ghost: "active:bg-accent",
        link: "",
      },
      size: {
        default: "h-12 px-5 py-3",
        sm: "h-10 px-3 rounded-md",
        lg: "h-14 px-8 rounded-md",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const buttonTextVariants = cva("text-base font-medium text-foreground", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      link: "text-primary",
    },
    size: {
      default: "",
      sm: "",
      lg: "text-lg",
      icon: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = React.ComponentPropsWithoutRef<typeof Pressable> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => {
    return (
      <TextClassContext.Provider
        value={cn(buttonTextVariants({ variant, size }))}
      >
        <Pressable
          className={cn(
            disabled && "opacity-50",
            buttonVariants({ variant, size, className }),
          )}
          ref={ref}
          role="button"
          disabled={disabled}
          {...props}
        />
      </TextClassContext.Provider>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants, buttonTextVariants };
