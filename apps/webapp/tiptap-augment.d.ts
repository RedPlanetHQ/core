import "@tiptap/core";

declare module "@tiptap/core" {
  interface Storage {
    markdown?: {
      getMarkdown(): string;
      [key: string]: unknown;
    };
  }
}
