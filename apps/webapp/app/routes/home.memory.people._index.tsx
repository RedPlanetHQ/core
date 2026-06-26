import { useState } from "react";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link, useFetcher } from "@remix-run/react";
import { Trash } from "lucide-react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { listContacts, hideContact } from "~/services/contacts/contact.server";
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

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  )) as string;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const contactId = form.get("contactId") as string;
    await hideContact(workspaceId, contactId);
    return json({ ok: true });
  }

  return json({ ok: false }, { status: 400 });
}

export default function PeopleIndex() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmContact, setConfirmContact] = useState<{ id: string; name: string } | null>(null);

  const submittingId =
    fetcher.state !== "idle"
      ? (fetcher.formData?.get("contactId") as string | null)
      : null;

  const visibleContacts = contacts.filter((c) => c.id !== submittingId && c.id !== pendingDeleteId);

  const handleConfirmDelete = () => {
    if (!confirmContact) return;
    setPendingDeleteId(confirmContact.id);
    fetcher.submit(
      { intent: "delete", contactId: confirmContact.id },
      { method: "post" },
    );
    setConfirmContact(null);
  };

  return (
    <div className="p-6">
      <p className="text-muted-foreground mb-4">
        Profiles of the people you interact with, drawn from your memory.
        Updated as new memory arrives.
      </p>
      <input
        className="border rounded px-3 py-2 mb-4 w-full max-w-md"
        placeholder="Search people"
        defaultValue={q}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("q", e.target.value);
          else next.delete("q");
          setParams(next);
        }}
      />
      <table className="w-full text-left">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2">Name</th>
            <th>Contact</th>
            <th>Description</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleContacts.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground py-6">
                {q
                  ? `No people match "${q}".`
                  : "No people yet. They appear here as CORE learns about the people you interact with."}
              </td>
            </tr>
          )}
          {visibleContacts.map((c) => (
            <tr key={c.id} className="border-t group">
              <td className="py-2">
                <Link
                  to={`/home/memory/people/${c.id}`}
                  className="font-medium hover:underline"
                >
                  {c.name}
                </Link>
              </td>
              <td>
                {c.emails[0] ?? c.phones[0] ?? (
                  <span className="text-muted-foreground">Add contact</span>
                )}
              </td>
              <td className="max-w-md truncate">{c.headline ?? ""}</td>
              <td>{c.status === "Researching" ? "Researching" : "Active"}</td>
              <td className="text-right pr-1">
                <button
                  type="button"
                  onClick={() => setConfirmContact({ id: c.id, name: c.name })}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1 rounded"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AlertDialog
        open={!!confirmContact}
        onOpenChange={(open) => { if (!open) setConfirmContact(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmContact?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove them from your People list. They may reappear if
              new memories mention them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
