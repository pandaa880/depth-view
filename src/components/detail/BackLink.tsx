import { Link } from '@tanstack/react-router';

import './backLink.css';

export function BackLink({ label = 'Markets' }: { label?: string }) {
  return (
    <Link to="/" className="back-link">
      <span aria-hidden="true">←</span> {label}
    </Link>
  );
}
