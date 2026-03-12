import { useState, useEffect } from "react";

export const useLocalCommonState = <T,>(key: string, initialValue?: T) => {
  const path = "userSettings";
  const [state, setState] = useState<T>(() => {
    // Try to load from localStorage on initial render
    const savedObject = typeof localStorage !== "undefined" ? localStorage.getItem(path) : null;
    const parsedObject = savedObject ? JSON.parse(savedObject) : {};
    return key in parsedObject ? parsedObject[key] : initialValue;
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    const savedObject = localStorage.getItem(path);
    const parsedObject = savedObject ? JSON.parse(savedObject) : {};
    localStorage.setItem(
      path,
      JSON.stringify({
        ...parsedObject,
        [key]: state,
      }),
    );
  }, [state, path, key]);

  return [state, setState] as const;
};
