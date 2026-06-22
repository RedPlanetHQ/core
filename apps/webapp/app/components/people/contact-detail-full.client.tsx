import React, { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Mail, Phone, Tag, RefreshCw, Trash2, User } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  extensionsForConversation,
  getPlaceholder,
} from "~/components/conversation/editor-extensions";
import { cn } from "~/lib/utils";

export interface ContactForDetail {
  id: string;
  name: string;
  headline: string | null;
  emails: string[];
  phones: string[];
  category: string | null;
  description: string | null;
  status: string;
}

interface ContactDetailFullProps {
  contact: ContactForDetail;
  onUpdate: (fields: {
    emails?: string[];
    phones?: string[];
    category?: string | null;
    description?: string;
  }) => void;
  onRefresh: () => void;
  onDelete: () => void;
  isRefreshing: boolean;
  isDeleting: boolean;
}

export function ContactDetailFull({
  contact,
  onUpdate,
  onRefresh,
  onDelete,
  isRefreshing,
  isDeleting,
}: ContactDetailFullProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 px-6 pt-4">
        <Button
          variant="ghost"
          className="gap-2 rounded"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            size={14}
            className={isRefreshing ? "animate-spin" : undefined}
          />
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </Button>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive gap-2 rounded"
          onClick={() => setConfirmDelete(true)}
          disabled={isDeleting}
        >
          <Trash2 size={14} />
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {contact.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the contact and the edits you've made.
              CORE may re-discover this person later from memory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="w-full overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="bg-grayAlpha-100 text-muted-foreground mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <User size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-semibold">
                {contact.name}
              </h1>
              {contact.headline && (
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {contact.headline}
                </p>
              )}
            </div>
          </div>

          <div className="bg-grayAlpha-50 flex flex-wrap items-center gap-1.5 rounded p-2">
            <CategoryPill
              value={contact.category}
              onChange={(v) => onUpdate({ category: v })}
            />

            <ListPill
              icon={<Mail size={14} />}
              label="Email"
              values={contact.emails}
              placeholder="name@example.com, …"
              onChange={(values) => onUpdate({ emails: values })}
            />

            <ListPill
              icon={<Phone size={14} />}
              label="Phone"
              values={contact.phones}
              placeholder="+1 415 555 0188, …"
              onChange={(values) => onUpdate({ phones: values })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Description
            </p>
            <DescriptionEditor
              key={contact.id}
              initialMarkdown={contact.description ?? ""}
              onChange={(markdown) => onUpdate({ description: markdown })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryPill({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if ((next || null) !== (value ?? null)) {
      onChange(next || null);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="gap-1 rounded">
          <Tag size={14} />
          {value ? (
            <span className="max-w-[140px] truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">Category</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Engineering"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(value ?? "");
              setOpen(false);
            }
          }}
          onBlur={commit}
        />
      </PopoverContent>
    </Popover>
  );
}

function ListPill({
  icon,
  label,
  values,
  placeholder,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  values: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values.join(", "));

  useEffect(() => {
    setDraft(values.join(", "));
  }, [values.join("|")]);

  const commit = () => {
    const next = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const a = next.join("|");
    const b = values.join("|");
    if (a !== b) onChange(next);
    setOpen(false);
  };

  const display = values[0];
  const extra = values.length - 1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="gap-1 rounded">
          {icon}
          {display ? (
            <span className="max-w-[200px] truncate">
              {display}
              {extra > 0 && (
                <span className="text-muted-foreground"> +{extra}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{label}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <span className="text-muted-foreground mb-1.5 block text-xs">
          {label} (comma separated)
        </span>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(values.join(", "));
              setOpen(false);
            }
          }}
          onBlur={commit}
        />
      </PopoverContent>
    </Popover>
  );
}

function DescriptionEditor({
  initialMarkdown,
  onChange,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialMarkdown);

  const editor = useEditor({
    extensions: [
      ...extensionsForConversation,
      getPlaceholder("Add a description in markdown…"),
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none",
          "min-h-[160px] rounded-md py-2",
        ),
      },
    },
    onUpdate({ editor }) {
      const md = (
        editor.storage as { markdown?: { getMarkdown: () => string } }
      ).markdown?.getMarkdown();
      if (md === undefined) return;
      if (md === lastSavedRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastSavedRef.current = md;
        onChange(md);
      }, 600);
    },
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return <EditorContent editor={editor} />;
}
