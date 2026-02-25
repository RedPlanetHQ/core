import { Card, CardContent } from "~/components/ui/card";
import Logo from "~/components/logo/logo";
import { LoginPageLayout } from "~/components/layout/login-page-layout";

interface ErrorViewProps {
  error?: string;
}

export function ErrorView({ error }: ErrorViewProps) {
  return (
    <LoginPageLayout>
      <Card className="bg-background-3 shadow-1 w-full max-w-md rounded-lg p-4 sm:p-6 md:p-8">
        <CardContent className="p-0">
          <div className="mb-4 flex items-center justify-center sm:mb-6">
            <Logo size={48} />
          </div>
          <div className="flex flex-col items-center space-y-4">
            <div className="mb-2 text-lg font-medium">Authentication failed</div>
            {error && <div className="text-muted-foreground my-2">{error}</div>}
            <p className="text-muted-foreground text-center">
              There was a problem authenticating you, please try logging in
              again.
            </p>
          </div>
        </CardContent>
      </Card>
    </LoginPageLayout>
  );
}
