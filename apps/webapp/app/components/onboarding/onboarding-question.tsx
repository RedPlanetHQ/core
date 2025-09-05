import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import type { OnboardingQuestion, OnboardingAnswer } from "./onboarding-utils";

interface OnboardingQuestionProps {
  question: OnboardingQuestion;
  answer?: string | string[];
  onAnswer: (answer: OnboardingAnswer) => void;
  onNext: () => void;
  onPrevious?: () => void;
  isFirst: boolean;
  isLast: boolean;
  currentStep: number;
  totalSteps: number;
}

export default function OnboardingQuestionComponent({
  question,
  answer,
  onAnswer,
  onNext,
  onPrevious,
  isFirst,
  isLast,
  currentStep,
  totalSteps,
}: OnboardingQuestionProps) {
  const [selectedValue, setSelectedValue] = useState<string | string[]>(
    answer || (question.type === "multi-select" ? [] : ""),
  );

  const handleSingleSelect = (value: string) => {
    console.log(value);
    setSelectedValue(value);
    onAnswer({ questionId: question.id, value });
  };

  const handleMultiSelect = (optionValue: string, checked: boolean) => {
    const currentValues = Array.isArray(selectedValue) ? selectedValue : [];
    const newValues = checked
      ? [...currentValues, optionValue]
      : currentValues.filter((v) => v !== optionValue);

    setSelectedValue(newValues);
    onAnswer({ questionId: question.id, value: newValues });
  };

  const isValid = () => {
    if (!question.required) return true;

    if (question.type === "multi-select") {
      return Array.isArray(selectedValue) && selectedValue.length > 0;
    }

    return selectedValue && selectedValue !== "";
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="bg-background-2 w-full rounded-lg p-3 pt-1">
        <CardHeader className="flex flex-col items-start px-0">
          <div className="mb-2 flex w-full items-center justify-between">
            <span className="text-muted-foreground text-sm">
              Step {currentStep} of {totalSteps}
            </span>
            <div className="bg-grayAlpha-100 h-1.5 w-32 rounded-full">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(currentStep / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="text-base">
          <div className="space-y-6">
            <div>
              <CardTitle className="mb-2 text-xl">{question.title}</CardTitle>
              {question.description && (
                <p className="text-muted-foreground mb-4 text-sm">
                  {question.description}
                </p>
              )}
            </div>

            {question.type === "single-select" && question.options && (
              <div className="space-y-3">
                {question.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant={
                      selectedValue === option.value ? "secondary" : "outline"
                    }
                    className="hover:bg-grayAlpha-100 h-auto w-full justify-start px-4 py-3 text-left font-normal"
                    onClick={() => handleSingleSelect(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}

            {question.type === "multi-select" && question.options && (
              <div className="space-y-3">
                {question.options.map((option) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={option.id}
                      checked={
                        Array.isArray(selectedValue) &&
                        selectedValue.includes(option.value)
                      }
                      onCheckedChange={(checked) =>
                        handleMultiSelect(option.value, !!checked)
                      }
                    />
                    <Label
                      htmlFor={option.id}
                      className="cursor-pointer text-base font-normal"
                    >
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-4">
              {!isFirst && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onPrevious}
                  className="rounded-lg px-4 py-2"
                >
                  Previous
                </Button>
              )}

              <div className="flex-1" />

              <Button
                type="button"
                variant="secondary"
                size="xl"
                onClick={onNext}
                disabled={!isValid()}
                className="rounded-lg px-4 py-2"
              >
                {isLast ? "Complete Profile" : "Continue"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
