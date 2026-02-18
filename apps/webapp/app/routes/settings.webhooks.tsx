import { useState, useEffect, useRef } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { requireUserId, requireWorkpace } from "~/services/session.server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { FormButtons } from "~/components/ui/FormButtons";
import { Plus, Trash2, Globe, Webhook } from "lucide-react";
import { prisma } from "~/db.server";
import { SettingSection } from "~/components/setting-section";

export async function loader({ request }: LoaderFunctionArgs) {
  const workspace = await requireWorkpace(request);

  const webhooks = await prisma.webhookConfiguration.findMany({
    where: {
      workspaceId: workspace?.id,
    },
    include: {
      _count: {
        select: {
          WebhookDeliveryLog: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return json({
    webhooks,
    workspace,
  });
}

export default function WebhooksSettings() {
  const { webhooks, workspace } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    url: "",
    secret: "",
  });

  // Track previous submitting state to detect when submission finishes
  const prevIsSubmitting = useRef(false);
  const isSubmitting = navigation.state === "submitting";

  // Close dialog when submission finishes and was open
  useEffect(() => {
    if (prevIsSubmitting.current && !isSubmitting && isDialogOpen) {
      setIsDialogOpen(false);
      setFormData({ url: "", secret: "" });
    }
    prevIsSubmitting.current = isSubmitting;
  }, [isSubmitting, isDialogOpen]);

  const resetForm = () => {
    setFormData({
      url: "",
      secret: "",
    });
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      resetForm();
    }
  };

  return (
    <div className="mx-auto flex w-auto flex-col gap-4 px-4 py-6 md:w-3xl">
      <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
        <SettingSection
          title="Logs"
          actions={
            <>
              {webhooks.length > 0 && (
                <DialogTrigger asChild>
                  <Button variant="secondary">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Webhook
                  </Button>
                </DialogTrigger>
              )}
            </>
          }
          description="View and monitor your data ingestion logs."
        >
          <div className="space-y-2">
            {webhooks.length === 0 ? (
              <Card>
                <CardContent className="bg-background-2 flex flex-col items-center justify-center py-12">
                  <Globe className="text-muted-foreground mb-4 h-12 w-12" />
                  <h3 className="text-lg font-medium">
                    No webhooks configured
                  </h3>
                  <p className="text-muted-foreground mb-4 text-center">
                    Add your first webhook to start receiving real-time
                    notifications
                  </p>
                  <Button
                    onClick={() => setIsDialogOpen(true)}
                    variant="secondary"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Webhook
                  </Button>
                </CardContent>
              </Card>
            ) : (
              webhooks.map((webhook) => (
                <Card key={webhook.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                          <Webhook className="h-4 w-4" />
                          {webhook.url}
                        </CardTitle>
                        <CardDescription className="text-sm">
                          Created{" "}
                          {new Date(webhook.createdAt).toLocaleDateString()}
                          {webhook._count.WebhookDeliveryLog > 0 && (
                            <span className="ml-2">
                              • {webhook._count.WebhookDeliveryLog} deliveries
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      <Form
                        method="post"
                        action={`/api/v1/webhooks/${webhook.id}`}
                      >
                        <input type="hidden" name="_method" value="DELETE" />
                        <Button type="submit" variant="ghost" size="sm">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Form>
                    </div>
                  </CardHeader>
                </Card>
              ))
            )}
          </div>
        </SettingSection>

        <DialogContent className="p-4 sm:max-w-md">
          <Form method="post" action="/api/v1/webhooks">
            <DialogHeader>
              <DialogTitle>Add New Webhook</DialogTitle>
              <DialogDescription>
                Configure a new webhook endpoint to receive activity
                notifications.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="url">Webhook URL</Label>
                <Input
                  id="url"
                  name="url"
                  type="url"
                  placeholder="https://your-site.com/webhook"
                  value={formData.url}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, url: e.target.value }))
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret">Secret (Optional)</Label>
                <Input
                  id="secret"
                  name="secret"
                  placeholder="Your webhook secret"
                  value={formData.secret}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      secret: e.target.value,
                    }))
                  }
                />
                <p className="text-muted-foreground text-sm">
                  Used to verify webhook authenticity via HMAC signature
                </p>
              </div>
            </div>

            <DialogFooter>
              <FormButtons
                cancelButton={
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDialogClose(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                }
                confirmButton={
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={isSubmitting || !formData.url}
                  >
                    {isSubmitting ? "Adding..." : "Add Webhook"}
                  </Button>
                }
              ></FormButtons>
            </DialogFooter>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
