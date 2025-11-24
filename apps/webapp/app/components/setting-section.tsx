interface SettingSectionProps {
  title: React.ReactNode | string;
  description: React.ReactNode | string;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingSection({
  title,
  description,
  metadata,
  children,
  actions,
}: SettingSectionProps) {
  return (
    <div className="flex w-auto flex-col gap-6 p-3 md:w-3xl">
      <div className="flex justify-between">
        <div className="flex shrink-0 flex-col">
          <h3 className="text-lg"> {title} </h3>
          <p className="text-muted-foreground">{description}</p>
          {metadata ? metadata : null}
        </div>

        <div>{actions}</div>
      </div>
      <div className="grow">
        <div className="flex h-full w-full justify-center">
          <div className="flex h-full grow flex-col gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
