import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertTriangle, Check } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SettingSection } from "~/components/setting-section";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { prisma } from "~/db.server";
import {
  PERSONALITY_OPTIONS,
  type PersonalityType,
} from "~/services/agent/prompts/personality";
import { cn } from "~/lib/utils";

interface SuccessDataResponse {
  success: boolean;
}

interface ErrorDataResponse {
  error: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);
  const metadata = user.metadata as Record<string, unknown> | null;
  const personality = (metadata?.personality as PersonalityType) || "tars";

  return json({
    user,
    personality,
    personalityOptions: PERSONALITY_OPTIONS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updatePersonality") {
    const personality = formData.get("personality") as string;
    const validPersonalities = PERSONALITY_OPTIONS.map((p) => p.id);

    if (
      !personality ||
      !validPersonalities.includes(personality as PersonalityType)
    ) {
      return json({ error: "Invalid personality" }, { status: 400 });
    }

    const currentMetadata = (user.metadata as Record<string, unknown>) || {};
    const updatedMetadata = {
      ...currentMetadata,
      personality,
    };

    await prisma.user.update({
      where: { id: user.id },
      data: { metadata: updatedMetadata },
    });

    return json({ success: true, personality });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
};

export default function AccountSettings() {
  const { user, personality, personalityOptions } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<SuccessDataResponse | ErrorDataResponse>();
  const personalityFetcher = useFetcher();
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const isDeleting = fetcher.state === "submitting";

  const currentPersonality =
    personalityFetcher.formData?.get("personality")?.toString() || personality;

  const handleDeleteAccount = () => {
    fetcher.submit(
      {},
      {
        method: "DELETE",
        action: "/api/v1/user/delete",
      },
    );
  };

  // Redirect to login after successful deletion
  if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
    setTimeout(() => {
      navigate("/login");
    }, 1000);
  }

  const canDelete = confirmText === user.email;

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Account Settings"
        description="Manage your account information and preferences"
      >
        <>
          {/* Account Information */}
          <div className="mb-8">
            <h2 className="text-md mb-4">Account Information</h2>
            <Card className="p-6">
              <div className="space-y-4">
                <div>
                  <Label className="text-muted-foreground text-sm">Email</Label>
                  <p className="text-base font-medium">{user.email}</p>
                </div>
                {user.name && (
                  <div>
                    <Label className="text-muted-foreground text-sm">
                      Name
                    </Label>
                    <p className="text-base font-medium">{user.name}</p>
                  </div>
                )}
                {user.displayName && (
                  <div>
                    <Label className="text-muted-foreground text-sm">
                      Display Name
                    </Label>
                    <p className="text-base font-medium">{user.displayName}</p>
                  </div>
                )}
                <div>
                  <Label className="text-muted-foreground text-sm">
                    Account Created
                  </Label>
                  <p className="text-base font-medium">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Personality */}
          <div className="mb-8">
            <h2 className="text-md mb-4">Personality</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              Choose how your digital brain communicates with you
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {personalityOptions.map((option) => (
                <Card
                  key={option.id}
                  className={cn(
                    "hover:border-primary/50 relative cursor-pointer p-4 transition-all",
                    currentPersonality === option.id &&
                      "border-primary/50 border-1",
                  )}
                  onClick={() => {
                    personalityFetcher.submit(
                      { intent: "updatePersonality", personality: option.id },
                      { method: "POST" },
                    );
                  }}
                >
                  {currentPersonality === option.id && (
                    <div className="absolute right-3 top-3">
                      <Check className="text-primary h-4 w-4" />
                    </div>
                  )}
                  <h3 className="mb-1 font-medium">{option.name}</h3>
                  <p className="text-muted-foreground mb-3 text-sm">
                    {option.description}
                  </p>
                  <div className="space-y-2">
                    {option.examples.map((example, idx) => (
                      <div
                        key={idx}
                        className="bg-muted/50 rounded-md p-2 text-xs"
                      >
                        <p className="text-muted-foreground mb-1">
                          "{example.prompt}"
                        </p>
                        <p className="italic">"{example.response}"</p>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="mb-8">
            <h2 className="text-md mb-4">Workspace access</h2>
            <Card className="p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-1 h-5 w-5" />
                <div className="flex-1">
                  <h3>Delete Account</h3>
                  <p className="mb-4 text-sm">
                    Permanently delete your account and all associated data.
                    This action cannot be undone.
                  </p>
                  <ul className="mb-4 list-inside list-disc space-y-1 text-sm">
                    <li>All your memories and conversations will be deleted</li>
                    <li>All integration connections will be removed</li>
                    <li>All API keys and webhooks will be revoked</li>
                    <li>
                      Your workspace and all its data will be permanently lost
                    </li>
                    <li>Active subscriptions will be cancelled immediately</li>
                  </ul>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={isDeleting}
                  >
                    Delete My Account
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </>
      </SettingSection>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  This action <strong>cannot be undone</strong>. This will
                  permanently delete your account and remove all your data from
                  our servers.
                </p>
                <div>
                  <Label
                    htmlFor="confirm-email"
                    className="text-sm font-medium"
                  >
                    To confirm, type your email address:{" "}
                    <span className="font-mono">{user.email}</span>
                  </Label>
                  <Input
                    id="confirm-email"
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Enter your email"
                    className="mt-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConfirmText("");
              }}
              disabled={isDeleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={!canDelete || isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete Account Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Success Message */}
      {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
        <div className="fixed bottom-4 right-4 rounded-md bg-green-600 p-4 text-white shadow-lg">
          Account deleted successfully. Redirecting...
        </div>
      )}

      {/* Error Message */}
      {fetcher.data && "error" in fetcher.data && (
        <div className="fixed bottom-4 right-4 rounded-md bg-red-600 p-4 text-white shadow-lg">
          {fetcher.data.error}
        </div>
      )}
    </div>
  );
}
