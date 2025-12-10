import { Body, Container, Head, Html, Link, Preview, Text } from "@react-email/components";
import { Footer } from "./components/Footer";
import { Image } from "./components/Image";
import { anchor, container, h1, main, paragraphLight } from "./components/styles";

export default function MagicLinkEmail({ magicLink }: { magicLink: string }) {
  return (
    <Html>
      <Head />
      <Preview>Log in with this magic link 🪄</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={h1}>Log in to C.O.R.E.</Text>
          <Link
            href={magicLink}
            target="_blank"
            style={{
              ...anchor,
              display: "block",
            }}
          >
            Click here to log in with this magic link
          </Link>
          <Text
            style={{
              ...paragraphLight,
              display: "block",
              marginBottom: "50px",
            }}
          >
            If you didn&apos;t try to log in, you can safely ignore this email.
          </Text>
          <Image path="/emails/logo-mono.png" width="120" height="22" alt="app.getcore.me" />
          <Footer />
        </Container>
      </Body>
    </Html>
  );
}
