import React, { createContext, useContext, useMemo, useState } from "react";

import { EmployeeProfile } from "@/lib/attendance";

type SessionContextValue = {
  employee: EmployeeProfile | null;
  setEmployee: (value: EmployeeProfile | null) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);

  const value = useMemo(() => ({ employee, setEmployee }), [employee]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
