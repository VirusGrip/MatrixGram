import type { Message } from './models';

export function sameMessageGroup(previous: Message | undefined, current: Message | undefined) {
  if (!previous || !current || previous.sender !== current.sender) return false;
  const gap = current.ts - previous.ts;
  return gap >= 0 && gap < 5 * 60_000
    && new Date(previous.ts).toDateString() === new Date(current.ts).toDateString()
    && !previous.deleted && !current.deleted && !previous.encrypted && !current.encrypted;
}

export function memberLabel(count: number) {
  if (count <= 0) return '';
  const ending = count % 100 >= 11 && count % 100 <= 14 ? 'участников'
    : count % 10 === 1 ? 'участник' : count % 10 >= 2 && count % 10 <= 4 ? 'участника' : 'участников';
  return `${count} ${ending}`;
}
