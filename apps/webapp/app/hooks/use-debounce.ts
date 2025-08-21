import { useState, useEffect } from 'react';

/**
 * Hook that debounces a value, delaying updates until after a specified delay
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function that cancels the timeout
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}