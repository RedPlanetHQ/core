import {
  isRouteErrorResponse,
  useNavigate,
  useRouteError,
} from "@remix-run/react";

import { friendlyErrorDisplay } from "~/utils/httpErrors";

import { type ReactNode } from "react";
import { Button } from "./ui";
import { Header1 } from "./ui/Headers";
import { Paragraph } from "./ui/Paragraph";
import Logo from "./logo/logo";

type ErrorDisplayOptions = {
  button?: {
    title: string;
    to: string;
  };
};

export function RouteErrorDisplay(options?: ErrorDisplayOptions) {
  const error = useRouteError();

  return (
    <>
      {isRouteErrorResponse(error) ? (
        <ErrorDisplay
          title={friendlyErrorDisplay(error.status, error.statusText).title}
          message={
            error.data.message ??
            friendlyErrorDisplay(error.status, error.statusText).message
          }
          {...options}
        />
      ) : error instanceof Error ? (
        <ErrorDisplay title={error.name} message={error.message} {...options} />
      ) : (
        <ErrorDisplay
          title="Oops"
          message={JSON.stringify(error)}
          {...options}
        />
      )}
    </>
  );
}

type DisplayOptionsProps = {
  title: string;
  message?: ReactNode;
} & ErrorDisplayOptions;

export function ErrorDisplay({ title, message, button }: DisplayOptionsProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-background-2 relative flex min-h-screen flex-col items-center justify-start">
      <div className="z-10 flex flex-col items-center gap-8">
        <div className="flex justify-center">
          <Logo size={60} />
        </div>
        <Header1>{title}</Header1>
        {message && <Paragraph>{message}</Paragraph>}
        <Button
          variant="secondary"
          onClick={() => {
            navigate("/");
          }}
        >
          {button ? button.title : "Go to homepage"}
        </Button>
      </div>
    </div>
  );
}
