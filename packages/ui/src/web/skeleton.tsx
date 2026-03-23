import React from "react";

import { cn } from "./utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-grayAlpha-200 animate-pulse rounded", className)}
      {...props}
    />
  );
}

export { Skeleton };
