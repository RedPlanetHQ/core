import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getContact,
  updateContactFields,
  hideContact,
} from "~/services/contacts/contact.server";
import { syncContactForEntity } from "~/jobs/contacts/contact-sync.logic";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  );
  const contact = await getContact(
    workspaceId as string,
    params.contactId as string,
  );
  if (!contact) throw new Response("Not found", { status: 404 });
  return json({ contact });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = (await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  )) as string;
  const contactId = params.contactId as string;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "hide") {
    await hideContact(workspaceId, contactId);
    return redirect("/home/memory/people");
  }

  if (intent === "refresh") {
    const contact = await getContact(workspaceId, contactId);
    if (!contact) throw new Response("Not found", { status: 404 });
    await syncContactForEntity({
      workspaceId,
      userId: contact.userId,
      userName: user.name ?? user.email ?? "the user",
      entityUuid: contact.entityUuid,
      name: contact.name,
      latestFactAt: contact.lastMemoryAt ?? new Date(),
      force: true,
    });
    return redirect(`/home/memory/people/${contactId}`);
  }

  const emails = String(form.get("emails") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const phones = String(form.get("phones") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const description = String(form.get("description") ?? "");
  const category = String(form.get("category") ?? "") || null;

  await updateContactFields(workspaceId, contactId, {
    emails: { set: emails },
    phones: { set: phones },
    category,
    description,
    descriptionEdited: true,
    editedAt: new Date(),
  });
  return redirect(`/home/memory/people/${contactId}`);
}

export default function ContactDetail() {
  const { contact } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const refreshing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "refresh";

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="text-muted-foreground">{contact.headline}</p>
        </div>
        <Form method="post">
          <button
            type="submit"
            name="intent"
            value="refresh"
            disabled={refreshing}
            className="border rounded px-3 py-1 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </Form>
      </div>

      <Form method="post" className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm">Emails (comma separated)</span>
          <input
            name="emails"
            defaultValue={contact.emails.join(", ")}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-sm">Phones (comma separated)</span>
          <input
            name="phones"
            defaultValue={contact.phones.join(", ")}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-sm">Category</span>
          <input
            name="category"
            defaultValue={contact.category ?? ""}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-sm">Description</span>
          <textarea
            name="description"
            defaultValue={contact.description ?? ""}
            rows={8}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="border rounded px-3 py-1">
            Save
          </button>
          <button
            type="submit"
            name="intent"
            value="hide"
            className="border rounded px-3 py-1"
          >
            Hide
          </button>
        </div>
      </Form>
    </div>
  );
}
