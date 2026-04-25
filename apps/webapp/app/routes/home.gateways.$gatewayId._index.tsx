import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

/**
 * /home/gateways/:gatewayId → land on the Info tab by default. Mirrors the
 * file-based tab layout used elsewhere (e.g. tasks).
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) return redirect("/home/gateways");
  return redirect(`/home/gateways/${gatewayId}/info`);
}

export default function GatewayIndexRedirect() {
  return null;
}
