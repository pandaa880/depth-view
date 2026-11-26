export interface FrameTaskOptions {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (handle: number) => void;
}

export interface FrameTask {
  request: () => void;
  flush: () => void;
  cancel: () => void;
}

const FALLBACK_DELAY = 250;

export function createFrameTask(
  callback: () => void,
  options: FrameTaskOptions = {},
): FrameTask {
  const requestFrame =
    options.requestAnimationFrame ??
    ((next: () => void) => globalThis.requestAnimationFrame(next));
  const cancelFrame =
    options.cancelAnimationFrame ??
    ((handle: number) => globalThis.cancelAnimationFrame(handle));
  const scheduleTimeout =
    options.setTimeout ??
    ((next: () => void, delay: number) =>
      window.setTimeout(next, delay));
  const cancelTimeout =
    options.clearTimeout ??
    ((handle: number) =>
      window.clearTimeout(handle));

  let pending = false;
  let frameHandle: number | null = null;
  let timeoutHandle: number | null = null;

  function invoke(source: 'frame' | 'timeout' | 'flush'): void {
    if (!pending) return;

    pending = false;
    const activeFrame = frameHandle;
    const activeTimeout = timeoutHandle;
    frameHandle = null;
    timeoutHandle = null;

    if (source !== 'frame' && activeFrame !== null) {
      cancelFrame(activeFrame);
    }
    if (source !== 'timeout' && activeTimeout !== null) {
      cancelTimeout(activeTimeout);
    }

    callback();
  }

  return {
    request() {
      if (pending) return;

      pending = true;
      frameHandle = requestFrame(() => invoke('frame'));
      timeoutHandle = scheduleTimeout(() => invoke('timeout'), FALLBACK_DELAY);
    },
    flush() {
      invoke('flush');
    },
    cancel() {
      if (frameHandle !== null) cancelFrame(frameHandle);
      if (timeoutHandle !== null) cancelTimeout(timeoutHandle);

      pending = false;
      frameHandle = null;
      timeoutHandle = null;
    },
  };
}
