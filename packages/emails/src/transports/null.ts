import { render, toPlainText } from "@react-email/render";
import { MailMessage, MailTransport, PlainTextMailMessage } from "./index";

export type NullMailTransportOptions = {
  type: undefined;
};

export class NullMailTransport implements MailTransport {
  constructor(options: NullMailTransportOptions) {}

  async send({ to, subject, react }: MailMessage): Promise<void> {
    const html = await render(react);
    const text = toPlainText(html);
    console.log(`
##### sendEmail to ${to}, subject: ${subject}

${text}
    `);
  }

  async sendPlainText({ to, subject, text }: PlainTextMailMessage): Promise<void> {
    console.log(`
##### sendEmail to ${to}, subject: ${subject}

${text}
    `);
  }
}
