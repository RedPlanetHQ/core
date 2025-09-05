import Logo from "../logo/logo";

export function LoginPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-[100vh] w-[100vw] grid-cols-1 overflow-hidden xl:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <Logo width={60} height={60} />
            </div>
            C.O.R.E.
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden xl:block">
        <img
          src="/login.png"
          alt="Image"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </div>
  );
}
