import { TeamIcon } from "../ui/team-icon";
import { type Label } from "@prisma/client";
import { Button } from "../ui";
import { useNavigate, useNavigation } from "@remix-run/react";

interface DocumentListProps {
  labels: Label[];
}

export const DocumentList = ({ labels }: DocumentListProps) => {
  const navigate = useNavigate();

  if (!labels || labels.length === 0) {
    return null;
  }

  return (
    <div className="px-2">
      <h2 className="text-muted-foreground mb-1"> Labels </h2>
      <div className="flex flex-col gap-0.5">
        <div>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => {
              navigate(`/home/labels/no_label`);
            }}
          >
            <TeamIcon color="#A4A2A2" name="No label" />
            No label
          </Button>
        </div>
        {labels.map((label: Label, index: number) => {
          return (
            <div key={index}>
              <Button
                variant="secondary"
                className="gap-2"
                onClick={() => {
                  navigate(`/home/labels/${label.id}`);
                }}
              >
                <TeamIcon color={label.color} name={label.name} />
                {label.name}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
