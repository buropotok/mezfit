import type { ReactNode } from 'react';
import { openExternalLink } from '../telegram';
import { Text } from '../ui/primitives';

export function DiscussionMessageText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(/(^|[\s([{«“"])((?:https?:\/\/|www\.)[^\s<>"“”«»]+)/gi)) {
    const [, prefix, candidate] = match;
    const start = (match.index ?? 0) + prefix.length;
    let label = candidate.replace(/[.,!?;:}]+$/, '');
    if (!label.includes('[')) label = label.replace(/\]+$/, '');
    const excessParens = (label.match(/\)/g)?.length ?? 0) - (label.match(/\(/g)?.length ?? 0);
    for (let i = 0; i < excessParens && label.endsWith(')'); i++) label = label.slice(0, -1);
    const url = /^www\./i.test(label) ? `https://${label}` : label;
    try { new URL(url); }
    catch { continue; }
    parts.push(text.slice(offset, start), <a key={start} href={url} className="discussion-message-link"
      target="_blank" rel="noopener noreferrer" onClick={event => {
        event.stopPropagation();
        event.preventDefault();
        openExternalLink(url);
      }}>{label}</a>);
    offset = start + label.length;
  }
  return <Text variant="chat" className="discussion-message-text">{parts}{text.slice(offset)}</Text>;
}
