export type CreatureAction = 'pet' | 'feed' | 'play';
export interface Reaction { action: CreatureAction; startedAt: number; duration: number }
const durations: Record<CreatureAction, number> = { pet: 2.2, feed: 2.8, play: 3 };
const messages: Record<CreatureAction, string> = { pet: 'Nova leans into your touch.', feed: 'A little treat. A very happy Nova.', play: 'Nova does a happy little spin!' };

/** Ephemeral demo feedback; the future backend owns persistent pet state. */
export class CreatureSession {
  reaction: Reaction | null = null;
  bonds = 0;
  perform(action: CreatureAction, time: number, visible: boolean): { accepted: boolean; message: string } {
    if (!visible) return { accepted: false, message: 'Look back at Nova first, or choose Move here.' };
    if (this.reaction && time - this.reaction.startedAt < this.reaction.duration) return { accepted: false, message: 'Nova is still enjoying that!' };
    this.reaction = { action, startedAt: time, duration: durations[action] };
    this.bonds += 1;
    return { accepted: true, message: messages[action] };
  }
  active(time: number): Reaction | null {
    if (this.reaction && time - this.reaction.startedAt >= this.reaction.duration) this.reaction = null;
    return this.reaction;
  }
}
