import { useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "../../ui";
import { Textarea } from "../../ui/textarea";
import { Check, LoaderCircle } from "lucide-react";
import type { ConversationToolPart } from "../conversation-utils";
import type { ChatAddToolApproveResponseFunction } from "ai";

interface QuestionOption {
  label: string;
  description?: string;
  markdown?: string;
}

interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionProps {
  part: ConversationToolPart;
  addToolApprovalResponse: ChatAddToolApproveResponseFunction;
  setToolArgOverride?: (
    toolCallId: string,
    args: Record<string, unknown>,
  ) => void;
  isChatBusy?: boolean;
}

function QuestionBlock({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const isMulti = question.multiSelect ?? false;

  const toggleOption = (label: string) => {
    if (isMulti) {
      setSelected((prev) =>
        prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
      );
    } else {
      setSelected([label]);
      setShowCustom(false);
    }
  };

  const selectOther = () => {
    if (!isMulti) setSelected([]);
    setShowCustom(true);
  };

  const canSubmit =
    selected.length > 0 || (showCustom && customText.trim().length > 0);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const parts: string[] = [...selected];
    if (showCustom && customText.trim()) parts.push(customText.trim());
    onAnswer(parts.join(", "));
  };

  return (
    <div className="flex flex-col gap-3">
      {question.header && (
        <span className="bg-grayAlpha-100 text-muted-foreground w-fit rounded px-2 py-0.5 text-xs font-medium">
          {question.header}
        </span>
      )}

      <p className="text-sm font-medium">{question.question}</p>

      {question.options && question.options.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {question.options.map((opt) => {
            const isSelected = selected.includes(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => toggleOption(opt.label)}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-grayAlpha-50",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {isSelected && <Check size={10} strokeWidth={3} />}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-muted-foreground text-xs">
                      {opt.description}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          <button
            onClick={selectOther}
            className={cn(
              "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
              showCustom
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-grayAlpha-50",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                showCustom
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40",
              )}
            >
              {showCustom && <Check size={10} strokeWidth={3} />}
            </div>
            <span className="text-sm font-medium">Other</span>
          </button>
        </div>
      )}

      {(showCustom || !question.options?.length) && (
        <Textarea
          placeholder="Type your answer..."
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          className="min-h-[72px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          autoFocus={showCustom}
        />
      )}

      <div className="flex justify-end">
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          Submit
        </Button>
      </div>
    </div>
  );
}

export function AskUserQuestion({
  part,
  addToolApprovalResponse,
  setToolArgOverride,
  isChatBusy,
}: AskUserQuestionProps) {
  const input = part.input as { questions?: Question[] };
  const questions = input.questions ?? [];

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAnswer = (questionText: string, answer: string) => {
    const next = { ...answers, [questionText]: answer };
    setAnswers(next);

    if (Object.keys(next).length === questions.length) {
      setSubmitting(true);

      if (setToolArgOverride && part.toolCallId) {
        setToolArgOverride(part.toolCallId, { approved: true, answers: next });
      }
      if (part.approval?.id) {
        addToolApprovalResponse({ id: part.approval.id, approved: true });
      }

      setSubmitted(true);
    }
  };

  if (submitting && isChatBusy) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span>Running...</span>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-1 py-1">
        {Object.entries(answers).map(([q, a]) => (
          <div key={q} className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">{q}</span>{" "}
            <span>→ {a}</span>
          </div>
        ))}
      </div>
    );
  }

  const nextUnanswered = questions.find((q) => !(q.question in answers));
  if (!nextUnanswered) return null;

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(answers).map(([q, a]) => (
        <div
          key={q}
          className="text-muted-foreground border-border border-b pb-3 text-sm"
        >
          <span className="text-foreground font-medium">{q}</span>{" "}
          <span>→ {a}</span>
        </div>
      ))}

      <QuestionBlock
        question={nextUnanswered}
        onAnswer={(answer) => handleAnswer(nextUnanswered.question, answer)}
      />
    </div>
  );
}
