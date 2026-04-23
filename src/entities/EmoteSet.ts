/**
 * EmoteSet.ts — Manages all emotes for a single player.
 * Each scene holds one EmoteSet for the local player; remote players get
 * one lazily created on first /emote message received.
 */

import Phaser from 'phaser';
import { SmokeEmote }    from './SmokeEmote';
import { CoffeeEmote }   from './CoffeeEmote';
import { MusicEmote }    from './MusicEmote';
import { ZzzEmote }      from './ZzzEmote';
import { ThinkEmote }    from './ThinkEmote';
import { HeartsEmote }   from './HeartsEmote';
import { AngryEmote }    from './AngryEmote';
import { SweatEmote }    from './SweatEmote';
import { SparkleEmote }  from './SparkleEmote';
import { ConfettiEmote } from './ConfettiEmote';
import { FireEmote }     from './FireEmote';
import { GhostEmote }    from './GhostEmote';
import { RainEmote }     from './RainEmote';
import { FishingEmote }  from './FishingEmote';

export interface BaseEmote {
  active: boolean;
  stopsOnMove: boolean;
  start(): void;
  stop(): void;
  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, facingRight: boolean, scale: 'hub' | 'cabin' | 'room'): boolean;
}

/** Display text shown in chat / bubble when an emote starts. */
export const EMOTE_FLAVORS: Record<string, string> = {
  smoke:    '*lights a cigarette*',
  coffee:   '*sips coffee*',
  music:    '*♪ humming ♫*',
  zzz:      '*falls asleep*',
  think:    '*thinking...*',
  hearts:   '💕',
  angry:    '*steaming*',
  sweat:    '*nervous sweat*',
  sparkle:  '✨',
  confetti: '🎉 confetti!',
  fire:     '*on fire*',
  ghost:    '*spooky*',
  rain:     '*rain cloud*',
  fishing:  '*casts a line...*',
};

/** System message shown when the local player turns an emote off. */
export const EMOTE_OFF_MSGS: Record<string, string> = {
  smoke:    'Put it out',
  coffee:   'Put the cup down',
  music:    'Quiet now',
  zzz:      'Wake up!',
  think:    'Done thinking',
  hearts:   'Hearts gone',
  angry:    'Calmed down',
  sweat:    'Dried off',
  sparkle:  'Dazzle off',
  confetti: 'Party over',
  fire:     'Fire out',
  ghost:    'Boo done',
  rain:     'Cloud gone',
  fishing:  'Reeled in',
};

export class EmoteSet {
  private emotes = new Map<string, BaseEmote>();

  constructor() {
    this.emotes.set('smoke',    new SmokeEmote());
    this.emotes.set('coffee',   new CoffeeEmote());
    this.emotes.set('music',    new MusicEmote());
    this.emotes.set('zzz',      new ZzzEmote());
    this.emotes.set('think',    new ThinkEmote());
    this.emotes.set('hearts',   new HeartsEmote());
    this.emotes.set('angry',    new AngryEmote());
    this.emotes.set('sweat',    new SweatEmote());
    this.emotes.set('sparkle',  new SparkleEmote());
    this.emotes.set('confetti', new ConfettiEmote());
    this.emotes.set('fire',     new FireEmote());
    this.emotes.set('ghost',    new GhostEmote());
    this.emotes.set('rain',     new RainEmote());
    this.emotes.set('fishing',  new FishingEmote());
  }

  start(name: string): boolean {
    const e = this.emotes.get(name);
    if (!e) return false;
    e.start();
    return true;
  }

  stop(name: string): void { this.emotes.get(name)?.stop(); }

  stopAll(): void { this.emotes.forEach(e => e.stop()); }

  isActive(name: string): boolean { return this.emotes.get(name)?.active ?? false; }

  activeNames(): string[] {
    const out: string[] = [];
    this.emotes.forEach((e, n) => { if (e.active) out.push(n); });
    return out;
  }

  updateAll(
    g: Phaser.GameObjects.Graphics,
    delta: number,
    px: number, py: number,
    facingRight: boolean,
    scale: 'hub' | 'cabin' | 'room',
    isMoving = false,
  ): void {
    this.emotes.forEach(e => {
      if (!e.active) return;
      if (isMoving && e.stopsOnMove) { e.stop(); return; }
      e.update(g, delta, px, py, facingRight, scale);
    });
  }
}
