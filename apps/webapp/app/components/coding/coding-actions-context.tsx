import React, { createContext, useContext, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";

type CodingActionsValue = { onNewSession: () => void } | null;

const CodingActionsContext = createContext<CodingActionsValue>(null);
const SetCodingActionsContext = createContext<
  React.Dispatch<React.SetStateAction<CodingActionsValue>>
>(() => {});

export function CodingActionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<CodingActionsValue>(null);
  return (
    <SetCodingActionsContext.Provider value={setValue}>
      <CodingActionsContext.Provider value={value}>
        {children}
      </CodingActionsContext.Provider>
    </SetCodingActionsContext.Provider>
  );
}

export function useSetCodingActions() {
  return useContext(SetCodingActionsContext);
}

export function CodingActions() {
  const ctx = useContext(CodingActionsContext);
  if (!ctx) return null;

  return (
    <Button variant="secondary" onClick={ctx.onNewSession} className="gap-2">
      <Plus size={13} />
      New session
    </Button>
  );
}
