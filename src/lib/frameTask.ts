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

type AnimationFrameGlobal = {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

type TimerGlobal = {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
};

function defaultRequestFrame(callback: () => void): number {
  const frameGlobal = globalThis as unknown as AnimationFrameGlobal;
  if (typeof frameGlobal.requestAnimationFrame !== 'function') {
    throw new TypeError('requestAnimationFrame is unavailable');
  }
  return frameGlobal.requestAnimationFrame(callback);
}

function defaultCancelFrame(handle: number): void {
  const frameGlobal = globalThis as unknown as AnimationFrameGlobal;
  if (typeof frameGlobal.cancelAnimationFrame === 'function') {
    frameGlobal.cancelAnimationFrame(handle);
  }
}

function defaultSetTimeout(callback: () => void, delay: number): number {
  return (globalThis as unknown as TimerGlobal).setTimeout(callback, delay);
}

function defaultClearTimeout(handle: number): void {
  (globalThis as unknown as TimerGlobal).clearTimeout(handle);
}

export function createFrameTask(
  callback: () => void,
  options: FrameTaskOptions = {},
): FrameTask {
  const requestFrame = options.requestAnimationFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelAnimationFrame ?? defaultCancelFrame;
  const scheduleTimeout = options.setTimeout ?? defaultSetTimeout;
  const cancelTimeout = options.clearTimeout ?? defaultClearTimeout;

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
      try {
        frameHandle = requestFrame(() => invoke('frame'));
        timeoutHandle = scheduleTimeout(
          () => invoke('timeout'),
          FALLBACK_DELAY,
        );
      } catch (error) {
        pending = false;
        if (frameHandle !== null) cancelFrame(frameHandle);
        if (timeoutHandle !== null) cancelTimeout(timeoutHandle);
        frameHandle = null;
        timeoutHandle = null;
        throw error;
      }
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
