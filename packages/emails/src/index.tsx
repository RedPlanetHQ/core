import { ReactElement } from "react";

import { z } from "zod";

import { setGlobalBasePath } from "../emails/components/BasePath";

import WelcomeEmail, { WelcomeEmailSchema } from "../emails/welcome";
import { constructMailTransport, MailTransport, MailTransportOptions } from "./transports";
import MagicLinkEmail from "../emails/magic-link";

export { type MailTransportOptions };

export const DeliverEmailSchema = z
  .discriminatedUnion("email", [
    z.object({
      email: z.literal("magic_link"),
      magicLink: z.string().url(),
    }),
    WelcomeEmailSchema,
  ])
  .and(z.object({ to: z.string() }));

export type DeliverEmail = z.infer<typeof DeliverEmailSchema>;

export type SendPlainTextOptions = { to: string; subject: string; text: string };

export class EmailClient {
  #transport: MailTransport;

  #imagesBaseUrl: string;
  #from: string;
  #replyTo: string;

  constructor(config: {
    transport?: MailTransportOptions;
    imagesBaseUrl: string;
    from: string;
    replyTo: string;
  }) {
    this.#transport = constructMailTransport(config.transport ?? { type: undefined });

    this.#imagesBaseUrl = config.imagesBaseUrl;
    this.#from = config.from;
    this.#replyTo = config.replyTo;
  }

  async send(data: DeliverEmail) {
    const { subject, component } = this.#getTemplate(data);

    setGlobalBasePath(this.#imagesBaseUrl);

    return await this.#transport.send({
      to: data.to,
      subject,
      react: component,
      from: this.#from,
      replyTo: this.#replyTo,
    });
  }

  async sendPlainText(options: SendPlainTextOptions) {
    await this.#transport.sendPlainText({
      replyTo: this.#replyTo,
      ...options,
      from: this.#from,
    });
  }

  #getTemplate(data: DeliverEmail): {
    subject: string;
    component: ReactElement;
  } {
    switch (data.email) {
      case "magic_link":
        return {
          subject: "Magic sign-in link for Core",
          component: <MagicLinkEmail magicLink={data.magicLink} />,
        };

      case "welcome":
        return {
          subject: `Your CORE setup is ready ⚡`,
          component: <WelcomeEmail />,
        };
    }
  }
}

function formatErrorMessageForSubject(message?: string) {
  if (!message) {
    return "";
  }

  const singleLine = message.replace(/[\r\n]+/g, " ");
  return singleLine.length > 30 ? singleLine.substring(0, 27) + "..." : singleLine;
}
