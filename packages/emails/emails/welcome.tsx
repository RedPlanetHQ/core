import { Body, Head, Html, Link, Preview, Section, Text } from "@react-email/components";
import { Footer } from "./components/Footer";
import { anchor, bullets, footerItalic, main, paragraphLight } from "./components/styles";

export default function Email({ name }: { name?: string }) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to C.O.R.E. - Your Personal AI Assistant</Preview>
      <Body style={main}>
        <Text style={paragraphLight}>Hey {name ?? "there"},</Text>
        <Text style={paragraphLight}>Welcome to C.O.R.E., your new personal AI assistant!</Text>
        <Text style={paragraphLight}>
          I'm excited to help you streamline your daily tasks, boost your productivity, and make
          your work life easier. C.O.R.E. is designed to be intuitive and powerful, adapting to your
          unique needs and preferences.
        </Text>
        <Text style={paragraphLight}>
          To get started, you can{" "}
          <Link style={anchor} href="https://core.heysol.ai/home">
            visit your dashboard
          </Link>{" "}
          where you'll find all the features and capabilities at your disposal. Whether it's
          managing your schedule, handling communications, or automating repetitive tasks, I'm here
          to help.
        </Text>

        <Text style={paragraphLight}>
          If you have any questions or need assistance, don't hesitate to reach out. You can:{"\n"}•
          Ask me directly through the chat interface{"\n"}•{" "}
          <Link style={anchor} href="https://core.heysol.ai/support">
            Visit our support center
          </Link>
          {"\n"}• Join our{" "}
          <Link style={anchor} href="https://discord.gg/heysol">
            Discord community
          </Link>{" "}
          to connect with other users and our team
        </Text>

        <Text style={paragraphLight}>Looking forward to being your trusted assistant!</Text>

        <Text style={bullets}>Best regards,</Text>
        <Text style={bullets}>C.O.R.E.</Text>
        <Text style={paragraphLight}>Your AI Assistant</Text>
        <Text style={footerItalic}>
          You can customize your notification preferences anytime in your account settings.
        </Text>
        <Footer />
      </Body>
    </Html>
  );
}
