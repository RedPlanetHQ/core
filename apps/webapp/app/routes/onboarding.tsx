import { Outlet } from "@remix-run/react";
import Logo from "~/components/logo/logo";

export default function OnboardingLayout() {
  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden">
      <div className="flex items-center px-6 md:px-10">
        <div className="flex items-center gap-2 py-4">
          <div className="flex size-8 items-center justify-center rounded-md">
            <Logo size={60} />
          </div>
          <span className="font-mono font-medium">C.O.R.E.</span>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
