import { postmanGet } from "./utils";

export async function integrationCreate(body: Record<string, any>) {
  const api_key: string | undefined = body.api_key ?? body.apiKey;
  if (!api_key) {
    throw new Error("api_key is required");
  }

  const me = await postmanGet<{ user: PostmanUser }>("/me", api_key);
  const user = me?.user;
  if (!user?.id) {
    throw new Error("Could not extract userId from Postman /me response");
  }

  return [
    {
      type: "account",
      data: {
        accountId: user.email ?? user.id.toString(),
        settings: {
          user: {
            id: user.id,
            name: user.fullName,
            username: user.username,
            email: user.email,
          },
        },
        config: {
          api_key,
        },
      },
    },
  ];
}

interface PostmanUser {
  id: number | string;
  username?: string;
  email?: string;
  fullName?: string;
}
