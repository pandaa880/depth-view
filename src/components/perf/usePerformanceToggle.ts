import { useEffect, useState } from 'react';

import { isEditableTarget } from './isEditableTarget';

function isToggleShortcut(event: KeyboardEvent): boolean {
  return (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing &&
    event.key.toLowerCase() === 'p' &&
    !isEditableTarget(event.target)
  );
}

/** Shift+P toggles visibility; hidden by default. */
export function usePerformanceToggle(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isToggleShortcut(event)) setVisible((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return visible;
}
