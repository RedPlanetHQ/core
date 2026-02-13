import { z } from "zod";
import { useActionData, useNavigation } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
  redirect,
} from "@remix-run/node";
import { useForm } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
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
import { createWorkspace } from "~/models/workspace.server";
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
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== 'success') {
    return json(submission.reply());
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

  if (user.confirmedBasicDetails) {
    return redirect(onboardingPath());
  }

  return typedjson({
    user,
    workspace: null,
  });
};

export default function ConfirmBasicDetails() {
  const lastSubmission = useActionData<typeof action>();
  const navigation = useNavigation();

  const [form, fields] = useForm({
    lastResult: navigation.state === 'idle' ? (lastSubmission as any) : null,
    constraint: getZodConstraint(schema),
    onValidate({ formData }) {
      return parseWithZod(formData, { schema });
    },
    // Validate the form on blur event triggered
    shouldValidate: 'onBlur',
    shouldRevalidate: 'onInput',
  });

  return (
    <LoginPageLayout>
      <Card className="min-w-[0] rounded-lg p-3 pt-1 md:min-w-[500px]">
        <CardHeader className="flex flex-col items-start px-0">
          <CardTitle className="px-0">Onboarding</CardTitle>
          <CardDescription>
            We just need you to confirm a couple of details, it'll only take a
            minute.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-2 text-base">
          <form method="post" id={form.id} onSubmit={form.onSubmit} noValidate>
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
                {fields.workspaceName.errors && (
                  <div className="text-sm text-red-500">
                    {fields.workspaceName.errors}
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
