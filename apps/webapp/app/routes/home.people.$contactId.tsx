import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { getWorkspaceId, requireUser } from "~/services/session.server";
import {
  getContact,
  updateContactFields,
  hideContact,
} from "~/services/contacts/contact.server";

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
    return redirect("/home/people");
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
  return redirect(`/home/people/${contactId}`);
}

export default function ContactDetail() {
  const { contact } = useLoaderData<typeof loader>();
  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{contact.name}</h1>
      <p className="text-muted-foreground">{contact.headline}</p>

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
