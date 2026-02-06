import {
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/server-runtime";
import { Plus, Copy } from "lucide-react";
import { Button } from "~/components/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useFetcher } from "@remix-run/react";
import { Input } from "~/components/ui/input";
import { useState } from "react";
import { parseWithZod } from "@conform-to/zod";
import { json } from "@remix-run/node";
import { z } from "zod";
import {
  createPersonalAccessToken,
  getValidPersonalAccessTokens,
  revokePersonalAccessToken,
} from "~/services/personalAccessToken.server";
import { requireUserId } from "~/services/session.server";
import { useTypedLoaderData } from "remix-typedjson";
import { APITable } from "~/components/api";
import { SettingSection } from "~/components/setting-section";

export const APIKeyBodyRequest = z.object({
  name: z.string(),
});

export const APIKeyDeleteBodyRequest = z.object({
  id: z.string(),
});

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);

  if (request.method === "DELETE") {
    const formData = await request.formData();
    const submission = parseWithZod(formData, {
      schema: APIKeyDeleteBodyRequest,
    });


    if (submission.status !== 'success') {
      return json(submission.reply());
    }


    const results = await revokePersonalAccessToken(submission.value.id);

    return json(results);
  }

  const formData = await request.formData();

  const submission = parseWithZod(formData, {
    schema: APIKeyBodyRequest,
  });


  if (submission.status !== 'success') {
    return json(submission.reply());
  }


  if (submission.value.name === "cli" || submission.value.name === "whatsapp") {
    return json(submission);
  }

  const results = await createPersonalAccessToken({
    name: submission.value.name,
    userId,
  });
  return json(results);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const personalAccessTokens = await getValidPersonalAccessTokens(userId);

  return personalAccessTokens;
}

export default function API() {
  const personalAccessTokens = useTypedLoaderData<typeof loader>();

  const [open, setOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const fetcher = useFetcher<{ token: string }>();
  const isSubmitting = fetcher.state !== "idle";
  const [name, setName] = useState("");

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    fetcher.submit({ name }, { method: "POST", action: "/settings/api" });
    setOpen(false);
    setShowToken(true);
  };

  const copyToClipboard = (text: string | undefined) => {
    text && navigator.clipboard.writeText(text);
  };

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <Dialog open={open} onOpenChange={setOpen}>
        <SettingSection
          title="API Keys"
          actions={
            <DialogTrigger asChild>
              <Button
                className="inline-flex items-center justify-center gap-1"
                variant="secondary"
              >
                <Plus size={16} />
                Create
              </Button>
            </DialogTrigger>
          }
          description="Create and manage API keys to access your data programmatically."
        >
          <div className="home flex h-full flex-col overflow-y-auto">
            <div className="flex items-center justify-between">
              <DialogContent className="p-3">
                <DialogHeader>
                  <DialogTitle>Create API Key</DialogTitle>
                </DialogHeader>
                <fetcher.Form
                  method="post"
                  onSubmit={onSubmit}
                  className="space-y-4"
                >
                  <div>
                    <Input
                      id="name"
                      onChange={(e) => setName(e.target.value)}
                      name="name"
                      placeholder="Enter API key name"
                      className="mt-1"
                      required
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "Creating..." : "Create API Key"}
                    </Button>
                  </div>
                </fetcher.Form>
              </DialogContent>
            </div>

            <APITable personalAccessTokens={personalAccessTokens} />
          </div>
        </SettingSection>
      </Dialog>

      <Dialog open={showToken} onOpenChange={setShowToken}>
        <DialogContent className="p-3">
          <DialogHeader>
            <DialogTitle>Your New API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              Make sure to copy your API key now. You won't be able to see it
              again!
            </p>
            <div className="flex items-center gap-2 rounded-md border p-3">
              <code className="flex-1 text-sm break-all">
                {fetcher.data?.token}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(fetcher.data?.token)}
              >
                <Copy size={16} />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
