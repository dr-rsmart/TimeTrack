import { createContext, useContext, useState } from "react";

const DemoRoleContext = createContext({ demoRole: null, setDemoRole: () => {} });

export function DemoRoleProvider({ children }) {
  const [demoRole, setDemoRole] = useState("admin");
  return (
    <DemoRoleContext.Provider value={{ demoRole, setDemoRole }}>
      {children}
    </DemoRoleContext.Provider>
  );
}

export function useDemoRole() {
  return useContext(DemoRoleContext);
}