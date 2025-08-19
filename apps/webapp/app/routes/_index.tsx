import { redirect, type MetaFunction } from "@remix-run/node";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";

import { requireUser } from "~/services/session.server";
import {
  confirmBasicDetailsPath,
  conversationPath,
  onboardingPath,
} from "~/utils/pathBuilder";

export const meta: MetaFunction = () => {
  return [
    { title: "C.O.R.E." },
    { name: "description", content: "Welcome to C.O.R.E!" },
  ];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  //you have to confirm basic details before you can do anything
  if (!user.confirmedBasicDetails) {
    return redirect(confirmBasicDetailsPath());
  } else if (!user.onboardingComplete) {
    return redirect(onboardingPath());
  } else {
    return redirect(conversationPath());
  }
};

export default function Index() {
  return <p>Loading</p>;
}
