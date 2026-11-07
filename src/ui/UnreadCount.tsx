import { Text } from './primitives';

/** Derived unread messages, never an entity status or a thread count. */
export function UnreadCount({ count, className = '' }: { count: number; className?: string }) {
  return count > 0 ? <sup className={className} aria-label={`Непрочитанных: ${count}`}>
    <Text variant="caption">{count}</Text></sup> : null;
}
