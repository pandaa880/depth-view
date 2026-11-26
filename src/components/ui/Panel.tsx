import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cx } from './cx';

type PanelProps = ComponentPropsWithoutRef<'section'> & {
  title?: ReactNode;
  description?: ReactNode;
  variant?: 'default' | 'flush';
};

export const Panel = ({
  title,
  description,
  variant = 'default',
  className,
  children,
  ...props
}: PanelProps) => {
  const hasHeader = title !== undefined || description !== undefined;

  return (
    <section
      className={cx('panel', variant === 'flush' && 'panel-flush', className)}
      {...props}
    >
      {hasHeader && (
        <div className="panel-header">
          <div className="panel-heading">
            {title !== undefined && <h2 className="panel-title">{title}</h2>}
            {description !== undefined && (
              <p className="panel-description">{description}</p>
            )}
          </div>
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
};
