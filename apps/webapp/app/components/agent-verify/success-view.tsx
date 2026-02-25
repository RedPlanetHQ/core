import { Card, CardContent } from "~/components/ui/card";
import Logo from "~/components/logo/logo";
import { LoginPageLayout } from "~/components/layout/login-page-layout";

const prettyClientNames: Record<string, string> = {
  "claude-code": "Claude Code",
  "cursor-vscode": "Cursor",
  "Visual Studio Code": "VSCode",
  "windsurf-client": "Windsurf",
  "claude-ai": "Claude Desktop",
  whatsapp: "Whatsapp",
  "core-cli": "Core cli",
};

function getInstructionsForSource(source: string) {
  if (source) {
    return `Return to your ${prettyClientNames[source] ?? source} to continue.`;
  }
  return `Return to your terminal to continue.`;
}

interface SuccessViewProps {
  source: string;
}

export function SuccessView({ source }: SuccessViewProps) {
  const whatsappNumber = "+12314444889";
  const whatsappMessage = encodeURIComponent(
    "hey I have connected. What can you do?",
  );

  return (
    <LoginPageLayout>
      <Card className="bg-background-3 shadow-1 w-full max-w-md rounded-lg p-4 sm:p-6 md:p-8">
        <CardContent className="p-0">
          <div className="mb-4 flex items-center justify-center sm:mb-6">
            <Logo size={48} />
          </div>
          <div className="flex flex-col items-center space-y-4">
            <div className="flex flex-col items-center gap-4">
              <div className="text-md text-center">
                <p className="text-lg font-medium">Authentication Successful</p>
                <p className="text-muted-foreground mt-2">
                  {getInstructionsForSource(source)}
                </p>
              </div>
              {source === "whatsapp" && (
                <a
                  href={`https://wa.me/${whatsappNumber}?text=${whatsappMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:outline-none"
                >
                  Open WhatsApp
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}
