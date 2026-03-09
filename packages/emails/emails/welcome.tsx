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
        <Text style={paragraphLight}>hi there 👋</Text>
        <Text
          style={{
            ...paragraphLight,
            marginTop: "10px",
          }}
        >
          <Link style={anchor} href="https://x.com/manikagg01">
            manik
          </Link>{" "}
          from core here. welcome to core. three things made it click for me:
        </Text>

        <Text style={heading}>meet your chief of staff</Text>
        <Text style={paragraphLight}>
          use core as your executive assistant on whatsapp, slack, imessage, and more.
        </Text>
        <Text style={{ ...paragraphLight, marginTop: 0 }}>
          set a reminder or a skill once, and it works proactively on your behalf in the background,
          no trigger, no prompt needed.{" "}
          <Link style={anchor} href="https://docs.getcore.me/quickstart/chief-of-staff">
            know more
          </Link>
          .
        </Text>
        <Img
          alt="Chief of Staff"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%",
            borderRadius: "2%",
            marginTop: "10px",
          }}
          src="https://integrations.heysol.ai/public/chief_of_staff.png"
        />

        <Text style={heading}>supercharge your coding agent</Text>
        <Text style={paragraphLight}>
          add core to cursor, claude or any coding agent via a single mcp url. your agent gets
          persistent memory across sessions.
        </Text>
        <Text style={{ ...paragraphLight, marginTop: 0 }}>
          connect{" "}
          <Link style={anchor} href="https://docs.getcore.me/providers/claude">
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
          src="https://integrations.heysol.ai/public/supercharge-coding-agent.gif"
        />

        <Text style={heading}>sync chatgpt/gemini conversations</Text>
        <Text style={paragraphLight}>
          saving my insights from chatgpt/gemini conversations as memory in core for future
          reference. check steps to connect{" "}
          <Link style={anchor} href="https://docs.getcore.me/providers/browser-extension">
            here
          </Link>
          .
        </Text>
        <Img
          alt="Core Extension"
          style={{
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%",
            borderRadius: "2%",
            marginTop: "10px",
          }}
          src="https://integrations.heysol.ai/public/sync-chatgpt-conv.gif"
        />

        <Text style={heading}>need real-time, human help to get started?</Text>
        <Text style={paragraphLight}>
          - join our{" "}
          <Link style={anchor} href="https://discord.gg/YGUZcvDjUa">
            discord community
          </Link>{" "}
          & get direct help from our team
        </Text>
        <Text style={paragraphLight}>
          - we are open-source ⭐ us on {" "}
          <Link style={anchor} href="https://github.com/RedPlanetHQ/core">
            github
          </Link>
        </Text>

        <Footer />
      </Body>
    </Html>
  );
}
