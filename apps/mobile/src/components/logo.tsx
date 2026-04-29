// The webapp's <Logo> always renders in #C15E50 (brick red) regardless of
// theme, which gives good contrast on both light and dark backgrounds. The
// `logo-dark.svg` asset contains that coloured variant; `logo-light.svg` is
// a white-fill version meant for dark surfaces (splash, etc.).
import LogoBrand from "../../assets/logo-dark.svg";

export function Logo({ size = 60 }: { size?: number }) {
  return <LogoBrand width={size} height={size} />;
}
