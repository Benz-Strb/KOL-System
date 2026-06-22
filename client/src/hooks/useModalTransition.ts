import { useState, useEffect, useRef, useCallback } from 'react';

export const MODAL_TRANSITION_MS = 180;

// Drives fade+scale enter/exit for every modal in the app, plus shared
// behavior: locks background scroll and closes on Escape. `requestClose`
// should be wired to every dismiss trigger (backdrop click, X button,
// Cancel button) so the exit animation plays before the modal unmounts —
// calling the raw `onClose` prop directly skips the animation.
export function useModalTransition(onClose: () => void) {
  const [phase, setPhase] = useState<'entering' | 'entered' | 'exiting'>('entering');
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const requestClose = useCallback(() => {
    setPhase(p => {
      if (p === 'exiting') return p;
      closeTimer.current = setTimeout(onClose, MODAL_TRANSITION_MS);
      return 'exiting';
    });
  }, [onClose]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase('entered'));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { closed: phase !== 'entered', requestClose };
}
