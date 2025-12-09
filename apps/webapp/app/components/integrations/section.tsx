interface SectionProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  metadata?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({
  icon,
  title,
  description,
  metadata,
  children,
}: SectionProps) {
  return (
    <div className="flex h-full w-full flex-col gap-6 p-4 md:flex-row md:p-0">
      <div className="flex w-[400px] shrink-0 flex-col">
        {icon && <>{icon}</>}
        <h3 className="text-lg"> {title} </h3>
        <p className="text-muted-foreground">{description}</p>
        {metadata ? metadata : null}
      </div>
      <div className="grow">
        <div className="flex h-full w-full justify-end overflow-auto">
          <div className="flex h-full max-w-[76ch] grow flex-col gap-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
