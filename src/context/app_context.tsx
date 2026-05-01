import type { JSX } from "react";
import { createContext, useState } from "react";

/**
 * App-wide context. Scoped to app errors + a transient topic input value
 * (kept across navigation between home and deck so the user doesn't lose
 * what they typed if they bounce around).
 */
export interface AppContextType {
  appError: string;
  setAppError: (value: string) => void;

  topicInput: string;
  setTopicInput: (value: string) => void;
}

export const AppContext = createContext<AppContextType>({
  appError: "",
  setAppError: () => {},
  topicInput: "",
  setTopicInput: () => {},
});

export const ContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element => {
  const [appError, setAppError] = useState<string>("");
  const [topicInput, setTopicInput] = useState<string>("");

  const value: AppContextType = {
    appError,
    setAppError,
    topicInput,
    setTopicInput,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
