import { useState } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Mail, Clock, Check } from "lucide-react";
import { PageHeader } from "~/components/common/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ProviderCard } from "~/components/integrations/provider-card";
import { PROVIDER_CONFIGS } from "~/components/onboarding";
import { requireUserId } from "~/services/session.server";
import { prisma } from "~/db.server";
import { updateUser } from "~/models/user.server";
import { RiWhatsappFill } from "@remixicon/react";
import { SlackIcon } from "~/components/icons";

export async function loader({ request }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const metadata = (user?.metadata as any) || {};
  const whatsappOptin = metadata?.whatsappOptin || false;

  return json({ whatsappOptin });
}

export async function action({ request }: ActionFunctionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return json({ error: "User not found" }, { status: 404 });
  }

  const metadata = (user.metadata as any) || {};

  if (intent === "whatsapp-waitlist") {
    await updateUser({
      id: userId,
      metadata: {
        ...metadata,
        whatsappOptin: true,
      },
      onboardingComplete: user.onboardingComplete,
    });

    return json({ success: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

// Direct communication channels
const DIRECT_CHANNELS = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Chat with Core via WhatsApp messages",
    icon: RiWhatsappFill,
    status: "waitlist" as const,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Interact with Core directly in your Slack workspace",
    icon: SlackIcon,
    status: "coming_soon" as const,
  },
  {
    id: "email",
    name: "Email",
    description: "Send emails to Core and get intelligent responses",
    icon: Mail,
    status: "available" as const,
  },
];

function DirectChannelCard({
  channel,
  onClick,
  isOptedIn,
  onJoinWaitlist,
  isJoining,
}: {
  channel: (typeof DIRECT_CHANNELS)[0];
  onClick?: () => void;
  isOptedIn?: boolean;
  onJoinWaitlist?: () => void;
  isJoining?: boolean;
}) {
  const Icon = channel.icon;
  const isClickable = channel.status === "available";
  const isWaitlist = channel.status === "waitlist";

  return (
    <Card
      className={`transition-all ${isClickable ? "cursor-pointer hover:border-primary/50" : ""}`}
      onClick={isClickable ? onClick : undefined}
    >
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="bg-background-2 flex h-6 w-6 items-center justify-center rounded">
            <Icon size={18} />
          </div>
          {isWaitlist && isOptedIn && (
            <Badge className="bg-green-100 text-xs text-green-800 rounded">
              <Check size={10} />
              On Waitlist
            </Badge>
          )}
          {isWaitlist && !isOptedIn && (
            <Badge variant="secondary" className="text-xs">
              <Clock size={10} />
              Waitlist
            </Badge>
          )}
          {channel.status === "coming_soon" && (
            <Badge variant="secondary" className="text-xs">
              Coming Soon
            </Badge>
          )}
          {channel.status === "available" && (
            <Badge className="bg-green-100 text-xs text-green-800 rounded">
              Available
            </Badge>
          )}
        </div>
        <CardTitle className="text-base">{channel.name}</CardTitle>
        <CardDescription className="line-clamp-2 text-sm">
          {channel.description}
        </CardDescription>
        {isWaitlist && !isOptedIn && onJoinWaitlist && (
          <Button
            variant="secondary"

            className="mt-2 w-full rounded"
            onClick={(e) => {
              e.stopPropagation();
              onJoinWaitlist();
            }}
            disabled={isJoining}
          >
            {isJoining ? "Joining..." : "Join Waitlist"}
          </Button>
        )}
        {channel.id === "email" && <Button
          variant="secondary"

          className="mt-2 w-full rounded"
          onClick={(e) => {
            e.stopPropagation();
            onClick && onClick();
          }}
          disabled={isJoining}
        >
          Connect
        </Button>}
      </CardHeader>
    </Card>
  );
}

function EmailModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Connect via Email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-muted-foreground text-sm">
            Send any email to Core's Meta Agent and it will process your
            request using your memory and connected integrations.
          </p>

          <div className="bg-background rounded-lg p-2">
            <p className="text-sm font-medium">Email Address</p>
            <code className="text-primary text-md font-semibold">
              brain@getcore.me
            </code>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">What you can do:</p>
            <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
              <li>Ask questions that require memory recall</li>
              <li>Request actions across your connected apps</li>
              <li>Store important information for later</li>
              <li>Get summaries and insights from your data</li>
            </ul>
          </div>

          <p className="text-muted-foreground text-xs">
            Make sure to send from the email address associated with your Core
            account.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Connect() {
  const { whatsappOptin } = useLoaderData<typeof loader>();
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const fetcher = useFetcher<{ success: boolean }>();
  const providers = Object.values(PROVIDER_CONFIGS);

  const isJoiningWaitlist = fetcher.state === "submitting";
  const hasJoined = whatsappOptin || fetcher.data?.success;

  const handleDirectChannelClick = (channelId: string) => {
    if (channelId === "email") {
      setIsEmailModalOpen(true);
    }
  };

  const handleJoinWaitlist = (channelId: string) => {
    if (channelId === "whatsapp") {
      fetcher.submit(
        { intent: "whatsapp-waitlist" },
        { method: "post" }
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Connect" />

      <div className="home flex h-[calc(100vh_-_40px)] flex-col gap-8 overflow-y-auto p-4 px-5 md:h-[calc(100vh_-_56px)]">
        {/* Direct Section */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Messaging channels</h2>
            <p className="text-muted-foreground text-sm">
              Chat naturally with Core's Meta Agent through your preferred
              communication channel. Your agent has access to memory, toolkit
              integrations, and can take actions across all your connected apps.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {DIRECT_CHANNELS.map((channel) => (
              <DirectChannelCard
                key={channel.id}
                channel={channel}
                onClick={() => handleDirectChannelClick(channel.id)}
                isOptedIn={channel.id === "whatsapp" ? hasJoined : undefined}
                onJoinWaitlist={
                  channel.id === "whatsapp"
                    ? () => handleJoinWaitlist(channel.id)
                    : undefined
                }
                isJoining={channel.id === "whatsapp" ? isJoiningWaitlist : false}
              />
            ))}
          </div>
        </div>

        {/* AI Tools Section */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">AI Tools</h2>
            <p className="text-muted-foreground text-sm">
              For AI Tools can you write this
              Give any AI tool two superpowers: persistent memory across sessions and actions in your apps (GitHub, Slack, Linear, Gmail, and more). Connect once and every tool shares the same brain via MCP
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isConnected={false}
              />
            ))}
          </div>
        </div>
      </div>

      <EmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
      />
    </div>
  );
}
