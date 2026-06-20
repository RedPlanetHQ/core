import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Link } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import { listContacts } from "~/services/contacts/contact.server";

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
          </tr>
        </thead>
        <tbody>
          {contacts.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted-foreground py-6">
                {q
                  ? `No people match "${q}".`
                  : "No people yet. They appear here as CORE learns about the people you interact with."}
              </td>
            </tr>
          )}
          {contacts.map((c) => (
            <tr key={c.id} className="border-t">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
