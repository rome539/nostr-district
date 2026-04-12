/**
 * BaseScene.ts — Abstract base class shared by every playable scene.
 *
 * Provides all common panel fields, registry setup, shared keyboard handlers
 * (M, G, F, S, T, U, ENTER, ?), a common ESC chain helper, the emote command
 * helper, and a common shutdown cleanup method.
 *
 * ── How to use in a new scene ────────────────────────────────────────────────
 *
 *   export class MyScene extends BaseScene {
 *     private player!: Phaser.GameObjects.Image;
 *     // scene-specific fields only — all panels are inherited
 *
 *     create(): void {
 *       const myPubkey = this.registry.get('playerPubkey');
 *       this.snd.setRoom('myroom');
 *
 *       this.chatUI = new ChatUI();
 *       this.chatInput = this.chatUI.create('Placeholder…', ACCENT, (cmd) => this.handleCommand(cmd));
 *
 *       this.setupRegistryPanels(myPubkey);       // dmPanel, crewPanel, followsPanel
 *       this.setupCommonKeyboardHandlers();        // M G F S T U ENTER ?
 *
 *       this.input.keyboard?.on('keydown-E', () => { ... });  // scene-specific keys
 *       this.input.keyboard?.on('keydown-ESC', () => {
 *         if (document.activeElement === this.chatInput) return;
 *         if (this.hotkeyModal.isOpen()) { this.hotkeyModal.close(); return; }
 *         // scene-specific modals / overlays here…
 *         if (this.handleCommonEsc()) return;
 *         if (!this.isLeavingScene) { this.isLeavingScene = true; this.leaveScene(); }
 *       });
 *
 *       const unsubProfile = authStore.subscribe(...);
 *       this.settingsPanel.create();
 *       this.events.on('shutdown', () => {
 *         this.shutdownCommonPanels(unsubProfile);
 *         // scene-specific cleanup here…
 *       });
 *     }
 *
 *     // Override to block panel keys while a scene-specific modal is open:
 *     protected override shouldBlockPanelKeys(): boolean {
 *       return MyModal.isOpen();
 *     }
 *
 *     // Override for a custom T-key (terminal) behaviour:
 *     protected override onTKey(): void { ... }
 *   }
 */

import Phaser from 'phaser';
import { ChatUI } from '../ui/ChatUI';
import { DMPanel } from '../ui/DMPanel';
import { CrewPanel } from '../ui/CrewPanel';
import { FollowsPanel } from '../ui/FollowsPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { HotkeyModal } from '../ui/HotkeyModal';
import { EmoteSet, EMOTE_FLAVORS, EMOTE_OFF_MSGS } from '../entities/EmoteSet';
import { SoundEngine } from '../audio/SoundEngine';
import { ComputerUI } from '../ui/ComputerUI';
import { MuteList } from '../ui/MuteList';
import { PlayerPicker } from '../ui/PlayerPicker';
import { ProfileModal } from '../ui/ProfileModal';
import { RpsGame } from '../ui/RpsGame';
import { PollBoard } from '../ui/PollBoard';
import { destroyPlayerMenu } from '../ui/PlayerMenu';
import {
  sendChat, sendNameUpdate, sendRoomResponse,
  setRoomRequestHandler, setRoomGrantedHandler, setRoomDeniedHandler, setRoomKickHandler,
} from '../nostr/presenceService';
import { toggleMute, addBannedWord, removeBannedWord, getCustomBannedWords } from '../nostr/moderationService';
import { getRoomConfig } from '../stores/roomStore';
import { getStatus } from '../stores/statusStore';
import { P } from '../config/game.config';

export abstract class BaseScene extends Phaser.Scene {
  // ── Player text (assigned in each scene's createPlayer) ─────────────────
  protected playerName!: Phaser.GameObjects.Text;
  protected playerStatusText!: Phaser.GameObjects.Text;

  // ── Chat ─────────────────────────────────────────────────────────────────
  protected chatUI!: ChatUI;
  protected chatInput!: HTMLInputElement;

  // ── Registry-backed singleton panels (survive scene transitions) ─────────
  protected dmPanel!: DMPanel;
  protected crewPanel!: CrewPanel;
  protected followsPanel!: FollowsPanel;

  // ── Per-scene panels (recreated each scene visit) ────────────────────────
  protected settingsPanel = new SettingsPanel();
  protected hotkeyModal   = new HotkeyModal();
  protected computerUI    = new ComputerUI();
  protected muteList      = new MuteList();
  protected playerPicker  = new PlayerPicker();
  protected rpsGame       = new RpsGame();
  protected pollBoard     = new PollBoard();

  // ── Emotes / Audio ────────────────────────────────────────────────────────
  protected emoteSet = new EmoteSet();
  protected snd      = SoundEngine.get();

  // ── Scene state ────────────────────────────────────────────────────────────
  protected isLeavingScene = false;
  private roomRequestToast: HTMLElement | null = null;

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRY PANEL SETUP
  // Call once in create() after this.chatInput is assigned.
  // Fetches or creates dmPanel, crewPanel, followsPanel from the Phaser registry
  // so they persist across scene transitions.
  // ══════════════════════════════════════════════════════════════════════════
  protected setupRegistryPanels(myPubkey: string): void {
    this.dmPanel = this.registry.get('dmPanel') as DMPanel;
    if (!this.dmPanel) {
      this.dmPanel = new DMPanel(myPubkey);
      this.registry.set('dmPanel', this.dmPanel);
    }

    this.crewPanel = this.registry.get('crewPanel') as CrewPanel;
    if (!this.crewPanel) {
      this.crewPanel = new CrewPanel();
      this.registry.set('crewPanel', this.crewPanel);
    }

    let rfp = this.registry.get('followsPanel') as FollowsPanel | undefined;
    if (!rfp) { rfp = new FollowsPanel(); this.registry.set('followsPanel', rfp); }
    this.followsPanel = rfp;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON KEYBOARD HANDLERS
  // Call once in create() after setupRegistryPanels().
  // Registers M, G, F, S, T, U, ENTER, ? hotkeys shared by every scene.
  // Subclasses can override shouldBlockPanelKeys() and onTKey() for custom
  // behaviour (e.g., blocking while a room-specific modal is open).
  // ══════════════════════════════════════════════════════════════════════════
  protected setupCommonKeyboardHandlers(): void {
    this.rpsGame.setChatUI(this.chatUI);

    const ci = () => document.activeElement === this.chatInput;
    const blk = () => this.shouldBlockPanelKeys();

    // M — DMs
    this.input.keyboard?.on('keydown-M', () => {
      if (blk() || ci()) return;
      this.crewPanel.close(); this.dmPanel.toggle();
    });

    // G — Crew
    this.input.keyboard?.on('keydown-G', () => {
      if (blk() || ci()) return;
      this.dmPanel.close(); this.crewPanel.toggle();
    });

    // F — Follows
    this.input.keyboard?.on('keydown-F', () => {
      if (blk() || ci()) return;
      this.followsPanel.toggle();
    });

    // S — Settings
    this.input.keyboard?.on('keydown-S', () => {
      if (blk() || ci()) return;
      this.settingsPanel.toggle();
    });

    // T — Terminal / Avatar (override onTKey for custom behaviour)
    this.input.keyboard?.on('keydown-T', () => {
      if (blk() || ci()) return;
      this.onTKey();
    });

    // U — Mute list
    this.input.keyboard?.on('keydown-U', () => {
      if (blk() || ci()) return;
      this.muteList.toggle();
    });

    // ENTER — focus chat / DM / crew input
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (blk()) return;
      if (document.activeElement?.closest('.dm-panel')) return;
      if (document.activeElement?.closest('.cp-panel')) return;
      if (this.dmPanel?.isOpen)        { this.dmPanel.focusInput();   return; }
      if (this.crewPanel?.isVisible()) { this.crewPanel.focusInput(); return; }
      if (document.activeElement !== this.chatInput) this.chatInput.focus();
    });

    // B — Poll board
    this.input.keyboard?.on('keydown-B', () => {
      if (blk() || ci()) return;
      this.pollBoard.toggle();
    });

    // ? — Hotkey modal (document-level listener so it works outside Phaser focus)
    const hotkeyHandler = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (ci()) return;
      this.hotkeyModal.toggle();
    };
    document.addEventListener('keydown', hotkeyHandler);
    this.events.once('shutdown', () => document.removeEventListener('keydown', hotkeyHandler));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROOM REQUEST HANDLERS
  // Call once in create() to register the incoming room-request toast.
  // Sets setRoomRequestHandler to show an accept/deny toast; clears
  // granted/denied/kick handlers (HubScene overrides those itself after
  // calling its own setupRoomRequestHandlers).
  // ══════════════════════════════════════════════════════════════════════════
  protected setupRoomRequestHandlers(): void {
    setRoomRequestHandler((rp, rn) => this.showRoomRequestToast(rp, rn));
    setRoomGrantedHandler(null);
    setRoomDeniedHandler(null);
    setRoomKickHandler(null);
  }

  protected showRoomRequestToast(rp: string, rn: string): void {
    this.roomRequestToast?.remove();
    this.snd.roomRequest();
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const accent = getRoomConfig()?.neonColor ?? this.getSceneAccent();
    this.roomRequestToast = document.createElement('div');
    this.roomRequestToast.style.cssText = `position:fixed;top:20px;right:20px;z-index:3000;background:linear-gradient(135deg,${P.bg},#0e0828);border:1px solid ${accent}55;border-radius:10px;padding:16px 20px;font-family:'Courier New',monospace;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:300px;`;
    this.roomRequestToast.innerHTML = `<div style="color:${accent};font-size:14px;font-weight:bold;margin-bottom:10px;">Room Request</div><div style="color:${P.lcream};font-size:13px;margin-bottom:14px;"><strong>${esc(rn)}</strong> wants to enter</div><div style="display:flex;gap:8px;"><button id="bc-ta" style="flex:1;padding:8px;background:${accent}33;border:1px solid ${accent}66;border-radius:6px;color:${accent};font-size:13px;cursor:pointer;font-weight:bold;">Accept</button><button id="bc-td" style="flex:1;padding:8px;background:${P.red}22;border:1px solid ${P.red}44;border-radius:6px;color:${P.red};font-size:13px;cursor:pointer;">Deny</button></div>`;
    document.body.appendChild(this.roomRequestToast);
    const dismiss = () => { this.roomRequestToast?.remove(); this.roomRequestToast = null; };
    this.roomRequestToast.querySelector('#bc-ta')!.addEventListener('click', () => { sendRoomResponse(rp, true, JSON.stringify(getRoomConfig())); dismiss(); });
    this.roomRequestToast.querySelector('#bc-td')!.addEventListener('click', () => { sendRoomResponse(rp, false); dismiss(); });
    setTimeout(() => { if (this.roomRequestToast) { sendRoomResponse(rp, false); dismiss(); } }, 30000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HOOKS — override in subclasses as needed
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Return true to block all panel hotkeys (M, G, F, S, T, U, ENTER).
   * Override in scenes where a scene-specific modal can capture keyboard input
   * (e.g., RoomScene overrides to return BookcaseModal.isOpen()).
   */
  protected shouldBlockPanelKeys(): boolean { return false; }

  /**
   * Called when the T key is pressed and not blocked.
   * Opens the ComputerUI in profile-only mode with name/status callbacks.
   * Override in scenes that need different terminal behaviour (e.g., RoomScene).
   */
  protected onTKey(): void {
    if (this.computerUI.isOpen()) { this.computerUI.close(); return; }
    this.computerUI.open(
      undefined,
      (newName) => {
        this.registry.set('playerName', newName);
        this.playerName.setText(newName.slice(0, 14));
        sendNameUpdate(newName);
      },
      undefined,
      undefined,
      (s) => {
        this.playerStatusText.setText(s.slice(0, 30));
        this.playerStatusText.setAlpha(s ? 1 : 0);
      },
      undefined,
      ['profile'],
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON ESC HANDLER
  // Call from the scene's keydown-ESC handler AFTER checking hotkeyModal and
  // any scene-specific overlays/modals, BEFORE calling leaveScene().
  // Returns true if a panel was closed — the caller should return early.
  //
  // Panel priority order:
  //   crewPanel → dmPanel → followsPanel → settingsPanel →
  //   playerPicker → muteList → profile-modal (DOM) → zap-modal (DOM)
  // ══════════════════════════════════════════════════════════════════════════
  protected handleCommonEsc(): boolean {
    if (this.crewPanel?.isVisible())    { this.crewPanel.pressEsc();    return true; }
    if (this.dmPanel?.isVisible())      { this.dmPanel.close();         return true; }
    if (this.followsPanel?.isVisible()) { this.followsPanel.close();    return true; }
    if (this.settingsPanel.isOpen())    { this.settingsPanel.toggle();  return true; }
    if (this.playerPicker.isOpen())     { this.playerPicker.close();    return true; }
    if (this.muteList.isOpen())         { this.muteList.close();        return true; }
    if (this.pollBoard.isVisible())     { this.pollBoard.close();       return true; }
    if (document.getElementById('profile-modal')) return true;
    if (document.getElementById('zap-modal'))     return true;
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RPS INCOMING CHAT HANDLER
  // Call from each scene's onChat callback BEFORE processing regular chat.
  // Returns true if the message was an RPS protocol message and was consumed
  // (the caller should return without further processing).
  // ══════════════════════════════════════════════════════════════════════════
  protected handleRpsIncoming(pk: string, name: string, text: string): boolean {
    if (!text.startsWith('/game:rps:')) return false;
    const myPk   = this.registry.get('playerPubkey') as string;
    const myName = (this.registry.get('playerName') as string) || 'Player';
    const ac     = this.getSceneAccent();
    return this.rpsGame.handleChat(pk, name, text, myPk, myName, (msg) => {
      this.chatUI.addMessage('system', msg, ac);
      if (msg.includes('wins') && msg.includes(myName)) this.snd.rpsWin();
      else if (msg.includes('wins')) this.snd.rpsLose();
      else this.snd.rpsTie();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMOTE COMMAND
  // Toggles an emote on/off, sends the nostr chat event, and posts a system
  // message. Identical across all scenes — subclasses just call this.
  // ══════════════════════════════════════════════════════════════════════════
  protected handleEmoteCommand(name: string): void {
    if (this.emoteSet.isActive(name)) {
      this.emoteSet.stop(name);
      this.chatUI.addMessage('system', EMOTE_OFF_MSGS[name] ?? 'Done', P.dpurp);
      sendChat(`/emote ${name}_off`);
    } else {
      this.emoteSet.start(name);
      if (name === 'smoke') this.snd.lighterFlick();
      const flavor = EMOTE_FLAVORS[name] ?? `*${name}*`;
      this.chatUI.addMessage('system', flavor, P.dpurp);
      sendChat(`/emote ${name}_on`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCENE ACCENT COLOR
  // Override in scenes that use a non-teal accent so system messages match.
  // ══════════════════════════════════════════════════════════════════════════
  protected getSceneAccent(): string { return P.teal; }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON COMMAND HANDLER
  // Call from every scene's handleCommand default case.
  // Returns true if the command was handled, false if unknown.
  // Scene-specific commands (leave, tp, dm, zap, players, visit) stay in each
  // scene's own switch before this is called.
  // ══════════════════════════════════════════════════════════════════════════
  protected handleCommonCommand(cmd: string, arg: string): boolean {
    const ac = this.getSceneAccent();
    switch (cmd) {
      // ── Emotes ────────────────────────────────────────────────────────────
      case 'smoke':
      case 'coffee': case 'music': case 'zzz': case 'think': case 'hearts':
      case 'angry': case 'sweat': case 'sparkle': case 'confetti': case 'fire':
      case 'ghost': case 'rain':
        this.handleEmoteCommand(cmd); return true;

      // ── Social panels ─────────────────────────────────────────────────────
      case 'follows': case 'following': case 'friends':
        this.followsPanel.toggle(); return true;
      case 'crew': case 'crews':
        this.dmPanel.close(); this.crewPanel.toggle(); return true;

      // ── Moderation ────────────────────────────────────────────────────────
      case 'mute': {
        const s = toggleMute();
        this.chatUI.addMessage('system', s ? 'Muted' : 'Unmuted', s ? P.amber : ac);
        return true;
      }
      case 'mutelist': case 'mutes': case 'blocked':
        this.muteList.toggle(); return true;
      case 'filter': {
        if (!arg) { const w = getCustomBannedWords(); this.chatUI.addMessage('system', w.length ? `Filtered: ${w.join(', ')}` : 'No filters', ac); return true; }
        addBannedWord(arg); this.chatUI.addMessage('system', `Added "${arg}"`, ac); return true;
      }
      case 'unfilter':
        if (arg) removeBannedWord(arg);
        return true;

      // ── Terminal / profile ────────────────────────────────────────────────
      case 'terminal': case 'avatar': case 'outfit': case 'computer':
        this.onTKey(); return true;

      // ── Mini-games ────────────────────────────────────────────────────────
      case 'flip': case 'coin': {
        this.snd.coinFlip();
        const result = Math.random() < 0.5 ? '👑 HEADS' : '🦅 TAILS';
        sendChat(`🪙 flipped a coin: ${result}`);
        return true;
      }
      case '8ball': {
        if (!arg) { this.chatUI.addMessage('system', 'Usage: /8ball <question>', ac); return true; }
        const responses = [
          'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You may rely on it.',
          'As I see it, yes.', 'Most likely.', 'Outlook good.', 'Signs point to yes.',
          'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
          'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.', 'Absolutely not.', 'The stars say no.',
        ];
        sendChat(`🎱 ${arg} — ${responses[Math.floor(Math.random() * responses.length)]}`);
        return true;
      }
      case 'slots': {
        const reels = ['🍒','🍋','🍊','🍇','💎','🍀','⭐','🎰'];
        const r = () => reels[Math.floor(Math.random() * reels.length)];
        const [a, b, c] = [r(), r(), r()];
        const jackpot = a === b && b === c;
        const two = !jackpot && (a === b || b === c || a === c);
        const result = jackpot ? '🎉 JACKPOT!' : two ? '✨ Two of a kind!' : '💸 No match.';
        this.snd.slotSpin();
        if (jackpot) setTimeout(() => this.snd.slotJackpot(), 680);
        else if (two) setTimeout(() => this.snd.slotTwoMatch(), 680);
        sendChat(`🎰 [ ${a} | ${b} | ${c} ] — ${result}`);
        return true;
      }
      case 'ship': {
        const spaceIdx = arg.indexOf(' ');
        const n1 = spaceIdx > -1 ? arg.slice(0, spaceIdx).trim() : arg.trim();
        const n2 = spaceIdx > -1 ? arg.slice(spaceIdx + 1).trim() : '';
        if (!n1 || !n2) { this.chatUI.addMessage('system', 'Usage: /ship <name1> <name2>', ac); return true; }
        const seed = [n1.toLowerCase(), n2.toLowerCase()].sort().join('|');
        let hash = 0; for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) & 0xfffffff;
        const pct = hash % 101;
        const label = pct >= 90 ? '💕 Soulmates!' : pct >= 70 ? '💖 Great match!' : pct >= 50 ? '💛 Good vibes.' : pct >= 30 ? '🤝 Could work.' : '😬 Rough road ahead.';
        const d1 = n1.startsWith('npub1') ? n1.slice(0, 13) + '…' : n1;
        const d2 = n2.startsWith('npub1') ? n2.slice(0, 13) + '…' : n2;
        sendChat(`💘 ${d1} + ${d2}: ${pct}% compatible — ${label}`);
        return true;
      }
      case 'rps': {
        const choices = ['rock', 'paper', 'scissors'] as const;
        const choice = arg.toLowerCase() as typeof choices[number];
        if (!choices.includes(choice)) { this.chatUI.addMessage('system', 'Usage: /rps <rock|paper|scissors>', ac); return true; }
        const myName = this.registry.get('playerName') || 'Player';
        this.rpsGame.challenge(choice, myName);
        this.chatUI.addMessage('system', '🎮 RPS challenge sent! Waiting for someone to accept...', ac);
        return true;
      }

      // ── Polls ─────────────────────────────────────────────────────────────
      case 'polls':
        this.pollBoard.toggle(); return true;

      // ── Status ────────────────────────────────────────────────────────────
      case 'status': {
        const myStatus = getStatus() || '(none)';
        this.chatUI.addMessage('system', `Your status: ${myStatus}`, ac);
        return true;
      }

      // ── Help ──────────────────────────────────────────────────────────────
      case 'help': case '?':
        this.hotkeyModal.toggle(); return true;

      default: return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON SHUTDOWN CLEANUP
  // Call as the first thing inside the scene's shutdown event handler.
  // Destroys / closes all panels that BaseScene manages.
  // Add any scene-specific cleanup AFTER this call.
  // ══════════════════════════════════════════════════════════════════════════
  protected shutdownCommonPanels(unsubProfile: () => void): void {
    unsubProfile();
    this.chatUI?.destroy();
    this.settingsPanel?.destroy();
    this.computerUI?.close();
    this.muteList?.destroy();
    this.playerPicker?.close();
    this.hotkeyModal?.close();
    if (this.dmPanel)      this.dmPanel.close();
    if (this.crewPanel)    this.crewPanel.close();
    if (this.followsPanel) this.followsPanel.close();
    destroyPlayerMenu();
    ProfileModal.destroy();
    this.rpsGame?.destroy();
    this.pollBoard?.destroy();
    this.roomRequestToast?.remove();
    this.roomRequestToast = null;
    setRoomRequestHandler(null);
  }
}
