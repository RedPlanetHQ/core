import { z } from "zod";
import { useActionData } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { useForm } from "@conform-to/react";
import { getFieldsetConstraint, parse } from "@conform-to/zod";
import { LoginPageLayout } from "~/components/layout/login-page-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Input } from "~/components/ui/input";
import { requireUser, requireUserId } from "~/services/session.server";
import { redirectWithSuccessMessage } from "~/models/message.server";
import { onboardingPath, rootPath } from "~/utils/pathBuilder";
import { createWorkspace, getWorkspaceByUser } from "~/models/workspace.server";
import { typedjson } from "remix-typedjson";

const schema = z.object({
  workspaceName: z
    .string()
    .min(3, "Your workspace name must be at least 3 characters")
    .max(50),
});

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  const submission = parse(formData, { schema });

  if (!submission.value || submission.intent !== "submit") {
    return json(submission);
  }

  const { workspaceName } = submission.value;

  try {
    await createWorkspace({
      integrations: [],
      name: workspaceName,
      userId,
    });

    return redirectWithSuccessMessage(
      rootPath(),
      request,
      "Your details have been updated.",
    );
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const workspace = await getWorkspaceByUser(user.id);

  if (user.confirmedBasicDetails) {
    return redirect(onboardingPath());
  }

  return typedjson({
    user,
    workspace,
  });
};

export default function ConfirmBasicDetails() {
  const lastSubmission = useActionData<typeof action>();

  const [form, fields] = useForm({
    lastSubmission: lastSubmission as any,
    constraint: getFieldsetConstraint(schema),
    onValidate({ formData }) {
      return parse(formData, { schema });
    },
    defaultValue: {
      integrations: [],
    },
  });

  return (
    <LoginPageLayout>
      <Card className="min-w-[500px] rounded-lg p-3 pt-1">
        <CardHeader className="flex flex-col items-start px-0">
          <CardTitle className="px-0">Onboarding</CardTitle>
          <CardDescription>
            We just need you to confirm a couple of details, it'll only take a
            minute.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-2 text-base">
          <form method="post" {...form.props}>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="workspaceName"
                  className="text-muted-foreground mb-1 block text-sm"
                >
                  Workspace Name
                </label>
                <Input
                  type="text"
                  id="workspaceName"
                  placeholder="Workspace name"
                  name={fields.workspaceName.name}
                  className="mt-1 block w-full text-base"
                />
                {fields.workspaceName.error && (
                  <div className="text-sm text-red-500">
                    {fields.workspaceName.error}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                variant="secondary"
                className="rounded-lg px-4 py-2"
              >
                Submit
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}
