import { describe, expect, it } from 'vitest';
import type { DiscussionFeedRow } from '../data/cloud/discussions';
import { thread, message } from './discussion-fixture.test-support';
import { discussionDateLabel, discussionLocalDate, groupDiscussionFeed } from './feed-presentation';

function row(id: string, createdAt: string | null): DiscussionFeedRow {
  return { thread: { ...thread, id }, latest: createdAt ? { ...message(id), createdAt } : null, unread: 0, hasAttachments: false };
}
describe('local calendar sections', () => {
  it('sorts by actual message time, with stable thread tie-break, without inventing a date for empty conversations', () => {
    const now = new Date(2026, 10, 7, 0, 1), yesterday = new Date(2026, 10, 6, 23, 59);
    const groups = groupDiscussionFeed([row('empty', null), row('z', now.toISOString()), row('older', yesterday.toISOString()), row('a', now.toISOString())]);
    expect(groups.map(group => group.date)).toEqual(['2026-11-07', '2026-11-06', '']);
    expect(groups[0].rows.map(row => row.thread.id)).toEqual(['a', 'z']);
    expect(discussionDateLabel(groups[0].date, now)).toBe('Сегодня');
    expect(discussionDateLabel(groups[1].date, now)).toBe('Вчера');
  });
  it('uses local components even when the UTC calendar date differs, across month/year rollover', () => {
    const local = new Date(2027, 0, 1, 0, 1);
    expect(discussionLocalDate(local.toISOString())).toBe('2027-01-01');
    expect(discussionDateLabel('2026-12-31', local)).toBe('Вчера');
    expect(discussionLocalDate(new Date(2026, 2, 29, 23, 59))).toBe('2026-03-29');
  });
});
