import type { StatusTone } from '../ui/StatusBadge';

export const getStatusTone = (status: string): StatusTone => {
  if (status === 'live' || status === 'open') return 'live';
  if (
    status === 'connecting' ||
    status === 'reconnecting' ||
    status === 'closing'
  ) {
    return 'pending';
  }
  return 'offline';
};
