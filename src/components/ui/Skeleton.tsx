import type { ComponentPropsWithoutRef } from 'react';

import { cx } from './cx';

type SkeletonProps = ComponentPropsWithoutRef<'div'>;

export const Skeleton = ({ className, ...props }: SkeletonProps) => (
  <div className={cx('skeleton', className)} aria-hidden="true" {...props} />
);
