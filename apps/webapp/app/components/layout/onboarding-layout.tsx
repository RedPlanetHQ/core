import { Button } from "../ui";
import Logo from "../logo/logo";
import { Theme, useTheme } from "remix-themes";

export function LoginPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10"
      style={{
        backgroundImage: 'url("/back.png")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="flex h-full w-full max-w-sm flex-col items-center gap-2 overflow-y-auto">
        <div className="flex size-10 items-center justify-center rounded-md">
          <Logo size={60} />
        </div>
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="font-mono">C.O.R.E.</div>
        </a>
        {children}
      </div>
    </div>
  );
}
