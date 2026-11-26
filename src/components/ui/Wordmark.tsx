import { cx } from './cx';

type WordmarkProps = {
  className?: string;
};

export const Wordmark = ({ className }: WordmarkProps) => (
  <span className={cx('wordmark', className)}>
    <span className="wordmark-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span>Depth View</span>
  </span>
);
