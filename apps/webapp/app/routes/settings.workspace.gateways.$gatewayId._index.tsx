import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

/**
 * /settings/workspace/gateways/:gatewayId → land on the Files tab by default. The
 * old Info tab content moved into the Files tab's Properties pane
 * empty state.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { gatewayId } = params;
  if (!gatewayId) return redirect("/settings/workspace/gateways");
  return redirect(`/settings/workspace/gateways/${gatewayId}/files`);
}

export default function GatewayIndexRedirect() {
  return null;
}
