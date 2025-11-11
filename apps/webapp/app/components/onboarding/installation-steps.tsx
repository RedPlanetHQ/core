import { type ReactNode } from "react";

export interface InstallationStep {
  title: string;
  component: ReactNode;
}

interface InstallationStepsProps {
  title: string;
  steps: InstallationStep[];
  className?: string;
}

export function InstallationSteps({
  title,
  steps,
  className = "",
}: InstallationStepsProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>

      <div className="space-y-0">
        {steps.map((step, index) => (
          <div key={index} className="flex gap-4">
            {/* Step number circle with connecting line */}
            <div className="flex flex-col items-center">
              <div className="bg-grayAlpha-100 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-gray-300">
                <span className="text-foreground text-sm font-medium">
                  {index + 1}
                </span>
              </div>
              {/* Vertical line connecting to next step */}
              {index < steps.length - 1 && (
                <div
                  className="w-px flex-1 bg-gray-300"
                  style={{ minHeight: "40px" }}
                />
              )}
            </div>

            {/* Step content */}
            <div className="mt-1 flex-1 space-y-3 pb-8">
              <h4 className="leading-relaxed font-medium">{step.title}</h4>
              <div>{step.component}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Optional: Helper component for code blocks in steps
export function StepCodeBlock({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-grayAlpha-200 rounded-lg border border-gray-300 p-4 font-mono text-sm ${className}`}
    >
      {children}
    </div>
  );
}

// Optional: Helper component for info boxes in steps
export function StepInfoBox({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-grayAlpha-100 rounded-lg border border-gray-200 p-3 text-sm ${className}`}
    >
      {children}
    </div>
  );
}
