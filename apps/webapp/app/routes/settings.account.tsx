import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AlertTriangle } from "lucide-react";
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

interface SuccessDataResponse {
  success: boolean;
}

interface ErrorDataResponse {
  error: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const user = await requireUser(request);

  return json({
    user,
  });
};

export default function AccountSettings() {
  const { user } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<SuccessDataResponse | ErrorDataResponse>();
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const isDeleting = fetcher.state === "submitting";

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
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
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
        <div className="fixed right-4 bottom-4 rounded-md bg-green-600 p-4 text-white shadow-lg">
          Account deleted successfully. Redirecting...
        </div>
      )}

      {/* Error Message */}
      {fetcher.data && "error" in fetcher.data && (
        <div className="fixed right-4 bottom-4 rounded-md bg-red-600 p-4 text-white shadow-lg">
          {fetcher.data.error}
        </div>
      )}
    </div>
  );
}
