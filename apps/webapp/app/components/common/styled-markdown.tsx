import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "~/lib/utils";

const markdownComponents: Components = {
  h1: ({ className, ...props }) => (
    <h1
      className={cn("mb-1 mt-2 text-3xl font-bold tracking-tight", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mb-1 mt-2 text-2xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mb-1 mt-2 text-xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mb-0.5 mt-1.5 text-lg font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "mb-0.5 mt-1.5 text-base font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "mb-0.5 mt-1.5 text-sm font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "mb-1 break-words leading-normal [&:not(:first-child)]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "my-1 ml-6 list-disc marker:text-gray-700 dark:marker:text-gray-400",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "my-1 ml-6 list-decimal marker:text-gray-700 dark:marker:text-gray-400",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("py-0.5 pl-1 leading-normal", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "mb-1 mt-1 border-l-4 border-gray-300 pl-4 italic text-gray-700 dark:text-gray-300",
        className,
      )}
      {...props}
    />
  ),
  code: ({ className, inline, ...props }: any) =>
    inline ? (
      <code
        className={cn(
          "bg-grayAlpha-100 text-muted-foreground rounded px-1.5 py-0 font-mono text-sm",
          className,
        )}
        {...props}
      />
    ) : (
      <code
        className={cn(
          "block rounded-lg bg-gray-100 p-4 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200",
          className,
        )}
        {...props}
      />
    ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "mb-1 overflow-x-auto rounded-lg bg-gray-100 p-4 dark:bg-gray-800",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, href, children, ...props }) => {
    const childText =
      typeof children === "string" ? children : String(children ?? "");
    const isBareUrl = childText === href && href && href.length > 50;
    const display = isBareUrl ? href!.slice(0, 50) + "…" : children;
    return (
      <a
        href={href}
        title={isBareUrl ? href : undefined}
        className={cn(
          "break-all font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300",
          className,
        )}
        {...props}
      >
        {display}
      </a>
    );
  },
  hr: ({ className, ...props }) => (
    <hr className={cn("my-2 border-t border-gray-300", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="mb-1 w-full overflow-auto">
      <table
        className={cn(
          "w-full border-collapse border border-gray-300",
          className,
        )}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead
      className={cn("bg-gray-100 dark:bg-gray-800", className)}
      {...props}
    />
  ),
  tbody: ({ className, ...props }) => (
    <tbody className={cn("", className)} {...props} />
  ),
  tr: ({ className, ...props }) => (
    <tr className={cn("border-b border-gray-300", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-gray-300 px-4 py-2 text-left font-semibold",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn("border border-gray-300 px-4 py-2", className)}
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-bold", className)} {...props} />
  ),
  em: ({ className, ...props }) => (
    <em className={cn("italic", className)} {...props} />
  ),
};

interface StyledMarkdownProps {
  children: string;
  className?: string;
  components?: Components;
}

export function StyledMarkdown({
  children,
  className,
  components,
}: StyledMarkdownProps) {
  return (
    <div
      className={cn(
        "max-w-none",
        "[&_ul_ul]:my-0.5 [&_ul_ul]:ml-4",
        "[&_ol_ol]:my-0.5 [&_ol_ol]:ml-4",
        "[&_ul_ol]:my-0.5 [&_ul_ol]:ml-4",
        "[&_ol_ul]:my-0.5 [&_ol_ul]:ml-4",
        className,
      )}
    >
      <ReactMarkdown components={{ ...markdownComponents, ...components }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
