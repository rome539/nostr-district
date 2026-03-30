/**
 * RpsGame.ts — Interactive Rock Paper Scissors challenge via chat.
 * Challenges appear as inline rows in the chat log — no overlay.
 */

import { sendChat } from '../nostr/presenceService';
import type { ChatUI } from './ChatUI';

type Choice = 'rock' | 'paper' | 'scissors';
const EMOJI: Record<Choice, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };

function beats(a: Choice, b: Choice): boolean {
  return (a === 'rock' && b === 'scissors') ||
         (a === 'scissors' && b === 'paper') ||
         (a === 'paper' && b === 'rock');
}

export class RpsGame {
  private pending: { choice: Choice; name: string } | null = null;
  private chatUI: ChatUI | null = null;

  setChatUI(ui: ChatUI): void { this.chatUI = ui; }

  /** Called when user types /rps <choice>. Sends challenge to chat. */
  challenge(choice: Choice, myName: string): void {
    this.pending = { choice, name: myName };
    sendChat(`/game:rps:challenge:${myName}`);
  }

  /**
   * Handle an incoming chat message. Returns true if consumed (not shown in log).
   * postResult: callback to display result string in local chat log.
   */
  handleChat(
    fromPk: string,
    fromName: string,
    text: string,
    myPk: string,
    myName: string,
    postResult: (msg: string) => void,
  ): boolean {
    // ── Incoming challenge from another player ──
    if (text.startsWith('/game:rps:challenge:')) {
      if (fromPk === myPk) return true; // own challenge — suppress
      const challengerName = text.slice('/game:rps:challenge:'.length);
      this.chatUI?.addRpsChallenge(challengerName, (choice) => {
        sendChat(`/game:rps:accept:${choice}:${fromPk}`);
      });
      return true;
    }

    // ── Someone accepted a challenge ──
    if (text.startsWith('/game:rps:accept:')) {
      const parts = text.split(':'); // /game:rps:accept:<choice>:<challengerPk>
      const acceptorChoice = parts[3] as Choice;
      const challengerPk   = parts[4];
      if (this.pending && challengerPk === myPk) {
        const myChoice = this.pending.choice;
        this.pending = null;
        const result = beats(myChoice, acceptorChoice)
          ? `${myName} wins! 🏆`
          : beats(acceptorChoice, myChoice)
          ? `${fromName} wins! 🏆`
          : "It's a tie! 🤝";
        const msg = `🎮 RPS: ${myName} ${EMOJI[myChoice]} vs ${fromName} ${EMOJI[acceptorChoice]} — ${result}`;
        postResult(msg);
        sendChat(msg);
      }
      return true;
    }

    return false;
  }

  destroy(): void { this.pending = null; }
}
