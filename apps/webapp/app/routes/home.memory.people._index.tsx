import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { User, Mail, Phone } from "lucide-react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { listContacts } from "~/services/contacts/contact.server";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  );
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const contacts = await listContacts(workspaceId as string, q);
  return json({ contacts, q });
}

export default function PeopleIndex() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <div className="flex w-full items-center gap-2 px-3 pt-3">
        <Input
          className="max-w-md"
          placeholder="Search people"
          defaultValue={q}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set("q", e.target.value);
            else next.delete("q");
            setParams(next);
          }}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto pb-4 pt-2">
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <User className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              {q
                ? `No people match "${q}".`
                : "No people yet. They appear here as CORE learns about the people you interact with."}
            </p>
          </div>
        ) : (
          contacts.map((c) => (
            <PersonRow
              key={c.id}
              contact={c}
              onClick={() => navigate(`/home/memory/people/${c.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PersonRow({
  contact,
  onClick,
}: {
  contact: {
    id: string;
    name: string;
    headline: string | null;
    emails: string[];
    phones: string[];
    status: string;
  };
  onClick: () => void;
}) {
  const contactValue = contact.emails[0] ?? contact.phones[0] ?? null;
  const ContactIcon = contact.emails[0]
    ? Mail
    : contact.phones[0]
      ? Phone
      : null;
  const isResearching = contact.status === "Researching";

  return (
    <a onClick={onClick} className={cn("group flex cursor-default gap-2 pr-4")}>
      <div className="flex w-full items-center">
        <div
          className={cn(
            "group-hover:bg-grayAlpha-100 ml-4 flex min-w-[0px] shrink grow items-start gap-2 rounded-xl pl-2 pr-2",
          )}
        >
          <div className="text-muted-foreground shrink-0 pt-2.5">
            <User size={16} />
          </div>

          <div
            className={cn(
              "border-border flex w-full min-w-[0px] shrink flex-col border-b py-2",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <div className="inline-flex min-w-[0px] shrink items-center justify-start">
                <div className="truncate text-left font-medium">
                  {contact.name}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {contactValue && ContactIcon && (
                  <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                    <ContactIcon size={13} className="shrink-0" />
                    <span className="max-w-[200px] truncate">
                      {contactValue}
                    </span>
                  </div>
                )}
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-1 rounded text-xs font-normal"
                >
                  {isResearching ? "Researching" : "Active"}
                </Badge>
              </div>
            </div>
            {contact.headline && (
              <div className="text-muted-foreground mt-0.5 truncate text-sm">
                {contact.headline}
              </div>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}
