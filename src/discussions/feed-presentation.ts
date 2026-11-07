import type { DiscussionFeedRow } from '../data/cloud/discussions';

/** Calendar arithmetic uses the device zone, including DST; never slice UTC dates. */
export function discussionLocalDate(instant: string | Date): string {
  const date = new Date(instant);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
}
export function discussionDateLabel(key: string, now = new Date()): string {
  if (key === discussionLocalDate(now)) return 'Сегодня';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (key === discussionLocalDate(yesterday)) return 'Вчера';
  return new Date(key + 'T12:00:00').toLocaleDateString('ru-RU');
}
export function sortDiscussionFeed<T extends DiscussionFeedRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.latest?.createdAt ?? '').localeCompare(a.latest?.createdAt ?? '')
    || a.thread.id.localeCompare(b.thread.id));
}
export function groupDiscussionFeed<T extends DiscussionFeedRow>(rows: readonly T[]): Array<{ date: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const row of sortDiscussionFeed(rows)) {
    const date = row.latest ? discussionLocalDate(row.latest.createdAt) : '';
    const group = groups.get(date) ?? []; group.push(row); groups.set(date, group);
  }
  return [...groups].map(([date, rows]) => ({ date, rows }));
}
