/**
 * pollService.ts — NIP-88 polls (kind:1068 events, kind:1018 responses)
 *
 * Uses pool.querySync() which returns Promise<Event[]> directly (nostr-tools v2.23+)
 */

import { signEvent, publishEvent } from './nostrService';

export interface PollOption { id: string; label: string; }

export interface Poll {
  id: string;
  pubkey: string;
  content: string;
  options: PollOption[];
  polltype: 'singlechoice' | 'multiplechoice';
  endsAt: number | null;
  relays: string[];
  createdAt: number;
}

export interface PollResults {
  totals: Map<string, number>;
  myVote: string[] | null;
  totalVoters: number;
}

// relay.nostr.band indexes all event kinds — best for rare kinds like 1068
const POLL_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://purplepag.es',
];

function parsePoll(e: any): Poll | null {
  try {
    const options: PollOption[] = (e.tags as string[][])
      .filter(t => t[0] === 'option' && t[1] && t[2])
      .map(t => ({ id: t[1], label: t[2] }));
    if (options.length < 2) return null;
    const relays = (e.tags as string[][]).filter(t => t[0] === 'relay' && t[1]).map(t => t[1]);
    const polltypeTag = (e.tags as string[][]).find(t => t[0] === 'polltype');
    const polltype = (polltypeTag?.[1] === 'multiplechoice' ? 'multiplechoice' : 'singlechoice') as Poll['polltype'];
    const endsAtTag = (e.tags as string[][]).find(t => t[0] === 'endsAt');
    const endsAt = endsAtTag ? Number(endsAtTag[1]) : null;
    return {
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      options,
      polltype,
      endsAt,
      relays: relays.length ? relays : POLL_RELAYS.slice(0, 2),
      createdAt: e.created_at,
    };
  } catch (_) { return null; }
}

export async function fetchPolls(limit = 30): Promise<Poll[]> {
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool();
  try {
    // querySync returns Promise<Event[]> in nostr-tools v2.23+
    // maxWait: ms to wait for events before returning
    const events: any[] = await (pool as any).querySync(
      POLL_RELAYS,
      { kinds: [1068], limit },
      { maxWait: 8000 },
    );
    console.log(`[Polls] fetched ${events.length} raw events`);
    const polls = events.map(parsePoll).filter(Boolean) as Poll[];
    polls.sort((a, b) => b.createdAt - a.createdAt);
    return polls;
  } catch (err) {
    console.warn('[Polls] fetchPolls error:', err);
    return [];
  } finally {
    pool.close(POLL_RELAYS);
  }
}

export async function fetchVotes(poll: Poll, myPubkey?: string | null): Promise<PollResults> {
  const relays = poll.relays.length ? poll.relays : POLL_RELAYS;
  const { SimplePool } = await import('nostr-tools/pool');
  const pool = new SimplePool();
  try {
    const filter: any = { kinds: [1018], '#e': [poll.id] };
    if (poll.endsAt) filter.until = poll.endsAt;

    const events: any[] = await (pool as any).querySync(relays, filter, { maxWait: 6000 });
    console.log(`[Polls] fetched ${events.length} vote events for poll ${poll.id.slice(0, 8)}`);

    // One vote per pubkey — latest wins
    const byPubkey = new Map<string, any>();
    for (const e of events) {
      const existing = byPubkey.get(e.pubkey);
      if (!existing || e.created_at > existing.created_at) byPubkey.set(e.pubkey, e);
    }

    const totals = new Map<string, number>();
    poll.options.forEach(o => totals.set(o.id, 0));
    let myVote: string[] | null = null;

    for (const [pk, e] of byPubkey) {
      const responses = (e.tags as string[][]).filter(t => t[0] === 'response').map(t => t[1]);
      const effective = poll.polltype === 'singlechoice' ? responses.slice(0, 1) : responses;
      const seen = new Set<string>();
      for (const optId of effective) {
        if (seen.has(optId)) continue;
        seen.add(optId);
        if (totals.has(optId)) totals.set(optId, (totals.get(optId) ?? 0) + 1);
      }
      if (myPubkey && pk === myPubkey) myVote = effective;
    }

    return { totals, myVote, totalVoters: byPubkey.size };
  } catch (err) {
    console.warn('[Polls] fetchVotes error:', err);
    return { totals: new Map(poll.options.map(o => [o.id, 0])), myVote: null, totalVoters: 0 };
  } finally {
    pool.close(relays);
  }
}

function randId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export async function createPoll(
  question: string,
  options: string[],
  polltype: Poll['polltype'],
  durationHours: number | null,
): Promise<Poll | null> {
  const tags: string[][] = [];
  const optionIds = options.map(() => randId());
  optionIds.forEach((id, i) => tags.push(['option', id, options[i].trim()]));
  POLL_RELAYS.slice(0, 2).forEach(r => tags.push(['relay', r]));
  tags.push(['polltype', polltype]);
  let endsAt: number | null = null;
  if (durationHours) {
    endsAt = Math.floor(Date.now() / 1000) + durationHours * 3600;
    tags.push(['endsAt', String(endsAt)]);
  }
  const unsigned = { kind: 1068, content: question.trim(), tags, created_at: Math.floor(Date.now() / 1000) };
  try {
    const signed = await signEvent(unsigned);
    const ok = await publishEvent(signed);
    if (!ok) return null;
    return {
      id: signed.id,
      pubkey: signed.pubkey,
      content: question.trim(),
      options: optionIds.map((id, i) => ({ id, label: options[i].trim() })),
      polltype,
      endsAt,
      relays: POLL_RELAYS.slice(0, 2),
      createdAt: signed.created_at,
    };
  } catch (err) {
    console.warn('[Polls] createPoll error:', err);
    return null;
  }
}

export async function castVote(poll: Poll, optionIds: string[]): Promise<boolean> {
  const tags: string[][] = [
    ['e', poll.id],
    ...optionIds.map(id => ['response', id]),
    ...poll.relays.slice(0, 2).map(r => ['relay', r]),
  ];
  const unsigned = { kind: 1018, content: '', tags, created_at: Math.floor(Date.now() / 1000) };
  try {
    const signed = await signEvent(unsigned);
    return await publishEvent(signed);
  } catch (err) {
    console.warn('[Polls] castVote error:', err);
    return false;
  }
}
