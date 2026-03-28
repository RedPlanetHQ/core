import { useState } from "react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireUser } from "~/services/session.server";
import { SettingSection } from "~/components/setting-section";
import { Button, Input } from "~/components/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Mail, MessageSquare, Send } from "lucide-react";
import {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from "~/services/channel.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    throw new Error("Workspace not found");
  }

  const channels = await getChannels(workspaceId);
  return json({ channels });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { workspaceId } = await requireUser(request);

  if (!workspaceId) {
    return json({ error: "Workspace not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = formData.get("name") as string;
    const type = formData.get("type") as "slack" | "telegram" | "whatsapp";
    const botToken = formData.get("bot_token") as string;
    const chatId = formData.get("chat_id") as string;
    const botUserId = formData.get("bot_user_id") as string;
    const userId = formData.get("user_id") as string;
    const accountSid = formData.get("account_sid") as string;
    const authToken = formData.get("auth_token") as string;
    const whatsappNumber = formData.get("whatsapp_number") as string;
    const phoneNumber = formData.get("phone_number") as string;
    const isDefault = formData.get("isDefault") === "true";

    if (!name || !type) {
      return json({ error: "Name and type are required" }, { status: 400 });
    }

    let config: Record<string, string> = {};

    if (type === "telegram") {
      if (!botToken || !chatId) {
        return json(
          { error: "Bot Token and Chat ID are required for Telegram" },
          { status: 400 },
        );
      }
      config = { bot_token: botToken, chat_id: chatId };
    } else if (type === "slack") {
      if (!botToken || !botUserId) {
        return json(
          { error: "Bot Token and Bot User ID are required for Slack" },
          { status: 400 },
        );
      }
      config = {
        bot_token: botToken,
        bot_user_id: botUserId,
        ...(userId ? { user_id: userId } : {}),
      };
    } else if (type === "whatsapp") {
      if (!phoneNumber) {
        return json(
          { error: "Your Phone Number is required for WhatsApp" },
          { status: 400 },
        );
      }
      config = {
        phone_number: phoneNumber,
        ...(accountSid ? { account_sid: accountSid } : {}),
        ...(authToken ? { auth_token: authToken } : {}),
        ...(whatsappNumber ? { whatsapp_number: whatsappNumber } : {}),
      };
    }

    try {
      await createChannel(workspaceId, { name, type, config, isDefault });
      return json({ success: true });
    } catch (err) {
      return json({ error: String(err) }, { status: 400 });
    }
  }

  if (intent === "setDefault") {
    const channelId = formData.get("channelId") as string;
    await updateChannel(channelId, workspaceId, { isDefault: true });
    return json({ success: true });
  }

  if (intent === "delete") {
    const channelId = formData.get("channelId") as string;
    try {
      await deleteChannel(channelId, workspaceId);
      return json({ success: true });
    } catch (err) {
      return json({ error: String(err) }, { status: 400 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <Mail size={15} />,
  slack: <MessageSquare size={15} />,
  telegram: <Send size={15} />,
  whatsapp: <MessageSquare size={15} />,
};

function AddChannelModal({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [type, setType] = useState<"slack" | "telegram" | "whatsapp">("telegram");
  const isSubmitting = fetcher.state === "submitting";

  if (fetcher.data?.success && !isSubmitting) {
    onClose();
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="create" />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as "slack" | "telegram" | "whatsapp")}
            name="type"
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="telegram">Telegram</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="whatsapp">WhatsApp (Twilio)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input name="name" placeholder="e.g. My Slack Bot" required />
        </div>

        {type !== "whatsapp" && (
          <div className="space-y-1.5">
            <Label>Bot Token</Label>
            <Input
              name="bot_token"
              placeholder={
                type === "telegram"
                  ? "1234567890:AAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                  : "xoxb-..."
              }
              required
            />
          </div>
        )}

        {type === "telegram" && (
          <div className="space-y-1.5">
            <Label>Chat ID</Label>
            <Input name="chat_id" placeholder="e.g. 123456789" required />
            <div className="space-y-1.5 rounded-md p-2 text-xs">
              <p className="font-medium">How to get your Chat ID:</p>
              <ol className="text-muted-foreground list-inside list-decimal space-y-1">
                <li>
                  Start a conversation with your bot (or add it to a group)
                </li>
                <li>Send any message to the bot</li>
                <li>
                  Open in browser:{" "}
                  <code className="bg-background rounded px-1">
                    https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates
                  </code>
                </li>
                <li>
                  Look for{" "}
                  <code className="bg-background rounded px-1">
                    "chat": {"{"} "id": 123456789 {"}"}
                  </code>{" "}
                  — that number is your Chat ID
                </li>
              </ol>
            </div>
          </div>
        )}

        {type === "slack" && (
          <>
            <div className="space-y-1.5">
              <Label>Bot User ID</Label>
              <Input
                name="bot_user_id"
                placeholder="e.g. UXXXXXXXXX"
                required
              />
              <p className="text-muted-foreground text-xs">
                Your Slack app's Bot User ID — found in the app's OAuth &amp;
                Permissions page.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>User ID (optional)</Label>
              <Input name="user_id" placeholder="e.g. UXXXXXXXXX" />
              <p className="text-muted-foreground text-xs">
                Your personal Slack user ID. Required for inbound DM routing.
              </p>
            </div>
          </>
        )}

        {type === "whatsapp" && (
          <>
            <div className="space-y-1.5">
              <Label>Your Phone Number</Label>
              <Input
                name="phone_number"
                placeholder="+1XXXXXXXXXX"
                required
              />
              <p className="text-muted-foreground text-xs">
                Your personal WhatsApp number where messages will be delivered.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Account SID (optional)</Label>
              <Input
                name="account_sid"
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Auth Token (optional)</Label>
              <Input
                name="auth_token"
                type="password"
                placeholder="Your Twilio Auth Token"
              />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp Number (optional)</Label>
              <Input
                name="whatsapp_number"
                placeholder="+1XXXXXXXXXX"
              />
              <p className="text-muted-foreground text-xs">
                Twilio WhatsApp-enabled number. Falls back to default if not provided.
              </p>
            </div>
          </>
        )}

        {fetcher.data?.error && (
          <p className="text-destructive text-sm">{fetcher.data.error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="secondary" disabled={isSubmitting}>
            {isSubmitting ? "Adding..." : "Add Channel"}
          </Button>
        </div>
      </div>
    </fetcher.Form>
  );
}

export default function ChannelsSettings() {
  const { channels } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  function handleOpenChange(v: boolean) {
    if (!v) {
      // Clean up pointer-events Radix leaves behind when Select is open inside Dialog
      document.body.style.pointerEvents = "";
      setModalKey((k) => k + 1);
    }
    setOpen(v);
  }

  return (
    <div className="md:w-3xl mx-auto flex w-auto flex-col gap-4 px-4 py-6">
      <SettingSection
        title="Channels"
        description="Configure notification channels for reminders and agent replies."
      >
        <div className="flex flex-col">
          <div className="mb-4 flex justify-between">
            <Dialog open={open} onOpenChange={handleOpenChange}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="lg" className="gap-1.5">
                  <Plus size={14} />
                  Add Channel
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Channel</DialogTitle>
                </DialogHeader>
                <AddChannelModal
                  key={modalKey}
                  onClose={() => handleOpenChange(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div>
            {channels.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No channels configured yet.
              </p>
            )}

            {channels.map((channel) => (
              <div
                key={channel.id}
                className="bg-background-3 group mb-2 flex justify-between rounded-lg p-2 px-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {CHANNEL_ICON[channel.type] ?? <MessageSquare size={15} />}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{channel.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {channel.type === "email"
                        ? (channel.config as Record<string, string>).address
                        : channel.type}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {channel.isDefault ? (
                    <Badge variant="secondary" className="text-xs">
                      Default
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100"
                      onClick={() => {
                        fetcher.submit(
                          { intent: "setDefault", channelId: channel.id },
                          { method: "post" },
                        );
                      }}
                    >
                      Set as Default
                    </Button>
                  )}
                  {channel.type !== "email" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                        >
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => {
                            fetcher.submit(
                              { intent: "delete", channelId: channel.id },
                              { method: "post" },
                            );
                          }}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingSection>
    </div>
  );
}
