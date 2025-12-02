import { Slot } from "@radix-ui/react-slot";

import { cva, type VariantProps } from "class-variance-authority";
import React from "react";

import { cn } from "../../lib/utils";
import { LoaderCircle } from "lucide-react";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded transition-colors focus-visible:outline-none focus-visible:shadow-none disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-slate-300",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white hover:bg-primary/90 dark:hover:bg-primary/90",
        destructive: "text-red-500 bg-grayAlpha-100 border-none",
        outline: "border border-border shadow-sm hover:bg-gray-100 shadow-none",
        secondary: "bg-grayAlpha-100 hover:bg-grayAlpha-200 border-none",
        ghost: "dark:focus-visible:ring-0 hover:bg-grayAlpha-100",
        link: "dark:focus-visible:ring-0",
      },
      size: {
        default: "h-7 rounded px-2 py-1",
        sm: "h-6 rounded-sm px-2 py-2",
        xs: "h-5 rounded-sm px-1 py-1",
        lg: "h-8 px-4 py-2",
        xl: "h-9 rounded px-8",
        "2xl": "h-12 rounded px-8",
        icon: "h-9 w-9",
      },
      full: {
        false: "w-auto",
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      full: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
  asChild?: boolean;
  isActive?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      full,
      asChild = false,
      children,
      isLoading,
      isActive,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, full, className }),
          isActive && "bg-accent text-accent-foreground",
        )}
        ref={ref}
        type="button"
        {...props}
        disabled={isLoading ?? disabled}
      >
        {isLoading ? <LoaderCircle className="mr-2 animate-spin" /> : <></>}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
