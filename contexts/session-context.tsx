import React, { createContext, useContext, useMemo, useState } from "react";

import { Branch, LocationPoint } from "@/lib/branches";
import { EmployeeProfile } from "@/lib/attendance";

type SessionContextValue = {
  employee: EmployeeProfile | null;
  setEmployee: (value: EmployeeProfile | null) => void;
  selectedBranch: Branch | null;
  setSelectedBranch: (value: Branch | null) => void;
  latestLocation: LocationPoint | null;
  setLatestLocation: (value: LocationPoint | null) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [latestLocation, setLatestLocation] = useState<LocationPoint | null>(null);

  const value = useMemo(
    () => ({
      employee,
      setEmployee,
      selectedBranch,
      setSelectedBranch,
      latestLocation,
      setLatestLocation,
    }),
    [employee, selectedBranch, latestLocation],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
