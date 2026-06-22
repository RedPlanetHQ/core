import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { LoaderCircle } from "lucide-react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getContact,
  updateContactFields,
  deleteContact,
} from "~/services/contacts/contact.server";
import { syncContactForEntity } from "~/jobs/contacts/contact-sync.logic";
import {
  ContactDetailFull,
  type ContactForDetail,
} from "~/components/people/contact-detail-full.client";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const workspaceId = await getWorkspaceId(
    request,
    user?.id as string,
    user.workspaceId,
  );
  const contactId = params.contactId as string;
  const contact = await getContact(workspaceId as string, contactId);
  if (!contact) throw new Response("Not found", { status: 404 });
  return json({
    contact: {
      id: contact.id,
      name: contact.name,
      headline: contact.headline,
      emails: contact.emails,
      phones: contact.phones,
      category: contact.category,
      description: contact.description,
      status: contact.status,
    } satisfies ContactForDetail,
  });
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

  if (intent === "delete") {
    await deleteContact(workspaceId, contactId);
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
    return json({ ok: true });
  }

  // Partial update — only touch fields the client sent.
  const data: Parameters<typeof updateContactFields>[2] = {};

  if (form.has("emails")) {
    const emails = String(form.get("emails") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    data.emails = { set: emails };
  }
  if (form.has("phones")) {
    const phones = String(form.get("phones") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    data.phones = { set: phones };
  }
  if (form.has("category")) {
    const raw = String(form.get("category") ?? "").trim();
    data.category = raw || null;
  }
  if (form.has("description")) {
    data.description = String(form.get("description") ?? "");
    data.descriptionEdited = true;
  }

  if (Object.keys(data).length > 0) {
    data.editedAt = new Date();
    await updateContactFields(workspaceId, contactId, data);
  }

  return json({ ok: true });
}

export default function ContactDetailRoute() {
  const { contact } = useLoaderData<typeof loader>();
  const updateFetcher = useFetcher();
  const refreshFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const handleUpdate = (fields: {
    emails?: string[];
    phones?: string[];
    category?: string | null;
    description?: string;
  }) => {
    const fd = new FormData();
    if (fields.emails !== undefined) fd.set("emails", fields.emails.join(","));
    if (fields.phones !== undefined) fd.set("phones", fields.phones.join(","));
    if (fields.category !== undefined) fd.set("category", fields.category ?? "");
    if (fields.description !== undefined)
      fd.set("description", fields.description);
    if ([...fd.keys()].length === 0) return;
    updateFetcher.submit(fd, { method: "POST" });
  };

  const handleRefresh = () => {
    refreshFetcher.submit({ intent: "refresh" }, { method: "POST" });
  };

  const handleDelete = () => {
    deleteFetcher.submit({ intent: "delete" }, { method: "POST" });
  };

  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <LoaderCircle className="h-4 w-4 animate-spin" />
        </div>
      }
    >
      {() => (
        <ContactDetailFull
          contact={contact}
          onUpdate={handleUpdate}
          onRefresh={handleRefresh}
          onDelete={handleDelete}
          isRefreshing={refreshFetcher.state !== "idle"}
          isDeleting={deleteFetcher.state !== "idle"}
        />
      )}
    </ClientOnly>
  );
}
