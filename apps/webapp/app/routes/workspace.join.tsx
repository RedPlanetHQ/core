import { z } from "zod";
import { useActionData, useNavigation } from "@remix-run/react";
import {
  type ActionFunctionArgs,
  json,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useForm } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod";
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
import { requireUserId } from "~/services/session.server";
import { typedjson } from "remix-typedjson";
import { prisma } from "~/db.server";
import { ensureBillingInitialized } from "~/services/billing.server";
import { LabelService } from "~/services/label.server";
import { logger } from "~/services/logger.service";
import { saveSession } from "~/services/sessionStorage.server";
import { redirect } from "@remix-run/node";
import Logo from "~/components/logo/logo";

const schema = z.object({
  workspaceName: z
    .string()
    .min(3, "Workspace name must be at least 3 characters")
    .max(50),
});

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);

  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema });

  if (submission.status !== "success") {
    return json(submission.reply());
  }

  const { workspaceName } = submission.value;

  try {
    // Generate slug: remove spaces, lowercase, add 5 random letters
    const generateRandomSuffix = () => {
      const chars = "abcdefghijklmnopqrstuvwxyz";
      return Array.from(
        { length: 5 },
        () => chars[Math.floor(Math.random() * chars.length)],
      ).join("");
    };

    const slug =
      workspaceName.replace(/\s+/g, "-").toLowerCase() + generateRandomSuffix();

    const workspace = await prisma.workspace.create({
      data: {
        slug,
        name: workspaceName,
        version: "V3",
        UserWorkspace: {
          create: {
            userId,
          },
        },
      },
    });

    await ensureBillingInitialized(workspace.id, userId);

    // Create persona document and label
    try {
      const labelService = new LabelService();

      await labelService.createLabel({
        name: "Persona",
        workspaceId: workspace.id,
        color: "#8B5CF6",
        description: "Personal persona generated from your episodes",
      });

      logger.info(`Created persona label for workspace ${workspace.id}`);
    } catch (e) {
      logger.error(`Error creating persona label: ${e}`);
    }

    // Update session with new workspaceId and redirect
    const headers = await saveSession(request, {
      userId,
      workspaceId: workspace.id,
    });

    return redirect("/", { headers });
  } catch (e: any) {
    return json({ errors: { body: e.message } }, { status: 400 });
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireUserId(request);

  return typedjson({});
};

export default function WorkspaceJoin() {
  const lastSubmission = useActionData<typeof action>();
  const navigation = useNavigation();

  const [form, fields] = useForm({
    lastResult: navigation.state === "idle" ? (lastSubmission as any) : null,
    constraint: getZodConstraint(schema),
    onValidate({ formData }) {
      return parseWithZod(formData, { schema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <LoginPageLayout>
      <Card className="min-w-[0] rounded-md bg-transparent p-3 md:min-w-[500px]">
        <CardHeader className="flex flex-col items-center px-0 text-center">
          <div className="mb-5 flex justify-center">
            <Logo size={60} />
          </div>
          <CardTitle className="px-0 text-xl">Create a new workspace</CardTitle>
          <CardDescription className="text-base">
            Workspaces are shared environments where teams can work on projects
            and collaborate.
          </CardDescription>
        </CardHeader>

        <CardContent className="text-md pt-2">
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
                  placeholder="My Workspace"
                  name={fields.workspaceName.name}
                  className="mt-1 block h-10 w-full text-base"
                />
                {fields.workspaceName.errors && (
                  <div className="text-sm text-red-500">
                    {fields.workspaceName.errors}
                  </div>
                )}
              </div>

              <Button
                type="submit"
                className="w-full rounded-lg px-4 py-2"
                full
                variant="secondary"
                size="xl"
                disabled={navigation.state === "submitting"}
              >
                {navigation.state === "submitting"
                  ? "Creating..."
                  : "Create workspace"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}
