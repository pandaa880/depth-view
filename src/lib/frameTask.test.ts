import { describe, expect, it, vi } from 'vitest';

import { createFrameTask, type FrameTaskOptions } from './frameTask';

function createScheduler() {
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let delay: number | undefined;

  const options: FrameTaskOptions = {
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
    setTimeout(callback, requestedDelay) {
      const handle = nextHandle++;
      delay = requestedDelay;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };

  return {
    options,
    frames,
    timers,
    get delay() {
      return delay;
    },
    fireFrame(handle: number) {
      const callback = frames.get(handle);
      if (!callback) throw new Error(`Unknown frame handle: ${handle}`);
      frames.delete(handle);
      callback();
    },
    fireTimeout(handle: number) {
      const callback = timers.get(handle);
      if (!callback) throw new Error(`Unknown timer handle: ${handle}`);
      timers.delete(handle);
      callback();
    },
  };
}

describe('createFrameTask', () => {
  it('coalesces requests into one callback per frame', () => {
    const scheduler = createScheduler();
    const callback = vi.fn();
    const task = createFrameTask(callback, scheduler.options);

    task.request();
    task.request();
    task.request();

    expect(scheduler.frames.size).toBe(1);
    expect(scheduler.timers.size).toBe(1);
    expect(scheduler.delay).toBe(250);
    expect(callback).not.toHaveBeenCalled();

    scheduler.fireFrame(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.timers.size).toBe(0);

    task.request();
    scheduler.fireFrame(3);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('flushes a pending callback immediately and only once', () => {
    const scheduler = createScheduler();
    const callback = vi.fn();
    const task = createFrameTask(callback, scheduler.options);

    task.flush();
    expect(callback).not.toHaveBeenCalled();

    task.request();
    task.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.timers.size).toBe(0);

    task.flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled work without executing and remains reusable', () => {
    const scheduler = createScheduler();
    const callback = vi.fn();
    const task = createFrameTask(callback, scheduler.options);

    task.request();
    task.cancel();
    task.flush();

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.timers.size).toBe(0);

    task.request();
    scheduler.fireFrame(3);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('allows reentrant requests after clearing pending state', () => {
    const scheduler = createScheduler();
    const callback = vi.fn(() => {
      if (callback.mock.calls.length === 1) task.request();
    });
    const task = createFrameTask(callback, scheduler.options);

    task.request();
    scheduler.fireFrame(1);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.frames.size).toBe(1);
    expect(scheduler.timers.size).toBe(1);

    scheduler.fireFrame(3);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.timers.size).toBe(0);
  });

  it('flushes from the timeout when no frame arrives', () => {
    const scheduler = createScheduler();
    const callback = vi.fn();
    const task = createFrameTask(callback, scheduler.options);

    task.request();
    scheduler.fireTimeout(2);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.frames.size).toBe(0);
    expect(scheduler.timers.size).toBe(0);

    task.flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
