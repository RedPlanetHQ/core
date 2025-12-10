import { Body, Head, Html, Img, Link, Preview, Text } from "@react-email/components";
import { Footer } from "./components/Footer";
import { anchor, heading, main, paragraphLight } from "./components/styles";
import { z } from "zod";

export const WelcomeEmailSchema = z.object({
  email: z.literal("welcome"),
});

export default function WelcomeEmail() {
  return (
    <Html>
      <Head />
      <Preview>building your digital brain</Preview>
      <Body style={main}>
        <Text style={paragraphLight}>hi there,</Text>
        <Text
          style={{
            ...paragraphLight,
            marginTop: "10px",
          }}
        >
          <Link style={anchor} href="https://x.com/manikagg01">
            Manik
          </Link>
          from core here. welcome to core. when i first tried core memory, two actions made it click
          for me. each came down to the same thing: understanding how I can add relevant context
          about everything that matters to me in core memory and recall it wherever I want.
        </Text>
        <Text style={heading}>core mcp</Text>
        <Text style={paragraphLight}>
          seamlessly add your code context from cursor/claude-code, project context from linear, or
          brainstorming sessions from claude desktop via mcp. solve context loss problems across ai
          tools with persistent, cross-session memory. add this url and get started
        </Text>
        <Text style={{ ...paragraphLight, display: "flex", alignItems: "center", marginTop: 0 }}>
          <Link
            style={{
              ...anchor,

              display: "inline-flex",
            }}
          >
            https://app.getcore.me/api/v1/mcp?source='Your Coding Agent'
          </Link>
          . Check how to connect{" "}
          <Link
            style={{
              ...anchor,
              marginLeft: "4px",
              display: "inline-flex",
            }}
            href="https://docs.getcore.me/providers/claude"
          >
            claude
          </Link>
          .
        </Text>

        <Img
          alt="Claude"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%",
            borderRadius: "2%",
            marginTop: "10px",
          }}
          src="https://integrations.heysol.ai/core-claude.gif"
        />
        <Text style={heading}>browser extension</Text>
        <Text style={paragraphLight}>
          recall relevant context from core memory in chatgpt, grok, and gemini. save conversations
          and content from chatgpt, grok, gemini, twitter, youtube, blog posts, and any webpage
          directly into your Core memory with simple text selection. Check steps to connect
          <Link
            style={{
              ...anchor,
              marginLeft: "4px",
              display: "inline-flex",
            }}
            href="https://docs.getcore.me/providers/browser-extension"
          >
            here
          </Link>
          .
        </Text>
        <Img
          alt="Claude"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%",
            borderRadius: "2%",
            marginTop: "10px",
          }}
          src="https://integrations.heysol.ai/core-extension.gif"
        />

        <Text style={heading}>need real-time, human help to get started? </Text>
        <Text style={paragraphLight}>
          - join our{" "}
          <Link style={anchor} href="https://discord.gg/YGUZcvDjUa">
            discord community
          </Link>{" "}
          & get direct help from our team + over 100+ enthusiasts using Core memory
        </Text>
        <Text style={paragraphLight}>
          - We are open-source us ⭐ on our repo -{" "}
          <Link style={anchor} href="https://github.com/RedPlanetHQ/core">
            https://github.com/RedPlanetHQ/core
          </Link>
        </Text>

        <Footer />
      </Body>
    </Html>
  );
}
