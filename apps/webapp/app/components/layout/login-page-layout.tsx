import Logo from "../logo/logo";

export function LoginPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-[100vh] w-[100vw] grid-cols-1 overflow-hidden xl:grid-cols-1">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
