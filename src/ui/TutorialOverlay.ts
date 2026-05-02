/**
 * TutorialOverlay — first-time player tutorial
 * Shows a step-by-step guide the first time a player logs in.
 * Completion is persisted to localStorage so it never shows again.
 */

const STORAGE_KEY = 'nd_tutorial_done';

export function isTutorialDone(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function markTutorialDone(): void {
  localStorage.setItem(STORAGE_KEY, '1');
}

interface Step {
  title: string;
  body: string;
  key?: string;
  img?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Nostr District',
    body: 'A pixel city living on the Nostr protocol. Everything here — chat, rooms, crews — is decentralized and owned by you.',
  },
  {
    title: 'Moving Around',
    body: 'Use the <b>Arrow Keys</b> or <b>click anywhere</b> on the ground to walk. You can explore the entire district from the hub.',
    key: '← →',
  },
  {
    title: 'Entering Buildings',
    body: 'Walk up to a building door and press <b>E</b> or <b>Space</b> to enter. You\'ll see a prompt appear when you\'re close enough. Press <b>Esc</b> to leave and return to the district.',
    key: 'E',
  },
  {
    title: 'Chat',
    body: 'Press <b>Enter</b> to focus the chat bar and talk with everyone in the district. Type <b>/help</b> to see all available commands.',
    key: 'Enter',
  },
  {
    title: 'Your Room',
    body: 'Head to <b>MY ROOM</b> — it\'s yours to customize. Change the walls, floors, add furniture, and hang art. Open the terminal with <b>T</b>.',
    key: 'T',
  },
  {
    title: 'Panels & Hotkeys',
    body: '<b>G</b> — Crews &nbsp;&nbsp; <b>M</b> — DMs &nbsp;&nbsp; <b>F</b> — Follows<br><b>S</b> — Settings &nbsp;&nbsp; <b>B</b> — Polls &nbsp;&nbsp; <b>T</b> — Terminal<br><b>Tab</b> — World map<br><br>Press <b>?</b> anytime to see all hotkeys. Type <b>/tutorial</b> to reopen this guide.',
  },
  {
    title: 'Crews',
    body: 'Join or create a <b>Crew</b> — your own private group with chat, posts, and member ranks. Press <b>G</b> to open.',
    key: 'G',
  },
  {
    title: 'The Shop',
    body: 'Type <b>/shop</b> in chat to open the item shop. Buy clothes, accessories, name colors, animations, and more — paid with Bitcoin over Lightning.',
    img: 'assets/shop.png',
  },
  {
    title: 'You\'re ready.',
    body: 'The district is yours. Explore, meet people, build your room, start a crew.<br><br>Everything is on Nostr — your identity travels with you.',
  },
];

export class TutorialOverlay {
  private overlay: HTMLDivElement;
  private stepIndex = 0;

  constructor(onDone: () => void) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'nd-tutorial-overlay';

    this.overlay.innerHTML = this.buildCSS() + `<div class="nd-tut-card" id="nd-tut-card"></div>`;
    document.body.appendChild(this.overlay);

    this.renderStep();

    // Navigation listeners
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') this.next(onDone, keyHandler);
      if (e.key === 'ArrowLeft' && this.stepIndex > 0) { this.stepIndex--; this.renderStep(); }
      if (e.key === 'Escape') this.finish(onDone, keyHandler);
    };
    document.addEventListener('keydown', keyHandler);
  }

  private renderStep(): void {
    const step = STEPS[this.stepIndex];
    const isLast = this.stepIndex === STEPS.length - 1;
    const card = this.overlay.querySelector('#nd-tut-card') as HTMLElement;
    card.style.maxWidth = step.img ? 'min(600px, 100%)' : 'min(440px, 100%)';

    const dots = STEPS.map((_, i) =>
      `<span class="nd-tut-dot${i === this.stepIndex ? ' active' : ''}"></span>`
    ).join('');

    card.innerHTML = `
      <div class="nd-tut-progress">${dots}</div>
      ${step.key ? `<div class="nd-tut-key">${step.key}</div>` : ''}
      <div class="nd-tut-title">${step.title}</div>
      <div class="nd-tut-body">${step.body}</div>
      ${step.img ? `<img src="${step.img}" class="nd-tut-img" alt="Shop preview">` : ''}
      <div class="nd-tut-actions">
        <button class="nd-tut-skip">Skip tutorial</button>
        <div class="nd-tut-nav">
          ${this.stepIndex > 0 ? `<button class="nd-tut-back">← Back</button>` : ''}
          <button class="nd-tut-next">${isLast ? 'Let\'s go →' : 'Next →'}</button>
        </div>
      </div>
    `;

    card.querySelector('.nd-tut-next')!.addEventListener('click', () => {
      if (isLast) {
        markTutorialDone();
        this.overlay.remove();
      } else {
        this.stepIndex++;
        this.renderStep();
      }
    });

    card.querySelector('.nd-tut-back')?.addEventListener('click', () => {
      this.stepIndex--;
      this.renderStep();
    });

    card.querySelector('.nd-tut-skip')!.addEventListener('click', () => {
      markTutorialDone();
      this.overlay.remove();
    });
  }

  private next(onDone: () => void, keyHandler: (e: KeyboardEvent) => void): void {
    if (this.stepIndex < STEPS.length - 1) {
      this.stepIndex++;
      this.renderStep();
    } else {
      this.finish(onDone, keyHandler);
    }
  }

  private finish(onDone: () => void, keyHandler: (e: KeyboardEvent) => void): void {
    markTutorialDone();
    document.removeEventListener('keydown', keyHandler);
    this.overlay.remove();
    onDone();
  }

  private buildCSS(): string {
    return `<style>
      .nd-tutorial-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.75);
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        font-family: 'Courier New', monospace;
        animation: nd-tut-fade 0.3s ease;
        overflow-y: auto;
      }
      @keyframes nd-tut-fade { from { opacity: 0; } to { opacity: 1; } }
      .nd-tut-card {
        background: color-mix(in srgb, #0a0a14 90%, var(--nd-accent, #5dcaa5));
        border: 1px solid color-mix(in srgb, var(--nd-accent, #5dcaa5) 40%, transparent);
        border-radius: 10px;
        padding: 28px 32px;
        max-width: 440px;
        width: 100%;
        max-height: calc(100dvh - 32px);
        overflow-y: auto;
        box-shadow: 0 0 40px color-mix(in srgb, var(--nd-accent, #5dcaa5) 15%, transparent),
                    0 8px 32px rgba(0,0,0,0.6);
        position: relative;
        animation: nd-tut-slide 0.25s ease;
      }
      @media (max-width: 480px) {
        .nd-tut-card { padding: 20px 18px; }
        .nd-tut-title { font-size: 15px; }
        .nd-tut-body { font-size: 12px; margin-bottom: 20px; }
      }
      @keyframes nd-tut-slide { from { transform: translateY(10px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }
      .nd-tut-progress {
        display: flex; gap: 6px; margin-bottom: 24px;
      }
      .nd-tut-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 25%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent, #5dcaa5) 40%, transparent);
        transition: background 0.2s;
      }
      .nd-tut-dot.active {
        background: var(--nd-accent, #5dcaa5);
        box-shadow: 0 0 6px var(--nd-accent, #5dcaa5);
      }
      .nd-tut-key {
        display: inline-block;
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent, #5dcaa5) 40%, transparent);
        color: var(--nd-accent, #5dcaa5);
        border-radius: 4px; padding: 2px 10px; font-size: 13px;
        margin-bottom: 12px; letter-spacing: 0.05em;
      }
      .nd-tut-title {
        font-size: 18px; font-weight: bold;
        color: var(--nd-accent, #5dcaa5);
        margin-bottom: 12px; letter-spacing: 0.03em;
      }
      .nd-tut-body {
        font-size: 13px; line-height: 1.7;
        color: color-mix(in srgb, white 75%, transparent);
        margin-bottom: 28px;
      }
      .nd-tut-body b { color: white; }
      .nd-tut-img {
        width: 100%; border-radius: 6px; margin-bottom: 20px;
        border: 1px solid color-mix(in srgb, var(--nd-accent, #5dcaa5) 25%, transparent);
      }
      .nd-tut-actions {
        display: flex; justify-content: space-between; align-items: center;
      }
      .nd-tut-nav { display: flex; gap: 8px; align-items: center; }
      .nd-tut-back {
        background: none;
        border: 1px solid color-mix(in srgb,var(--nd-accent, #5dcaa5) 30%,transparent);
        color: color-mix(in srgb,var(--nd-accent, #5dcaa5) 70%,transparent);
        font-family: inherit; font-size: 13px;
        padding: 8px 16px; border-radius: 4px; cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
      }
      .nd-tut-back:hover { border-color: color-mix(in srgb,var(--nd-accent, #5dcaa5) 60%,transparent); color: var(--nd-accent, #5dcaa5); }
      .nd-tut-skip {
        background: none; border: none;
        color: color-mix(in srgb, white 30%, transparent);
        font-family: inherit; font-size: 11px; cursor: pointer;
        padding: 0; transition: color 0.15s;
      }
      .nd-tut-skip:hover { color: color-mix(in srgb, white 60%, transparent); }
      .nd-tut-next {
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 20%, transparent);
        border: 1px solid color-mix(in srgb, var(--nd-accent, #5dcaa5) 50%, transparent);
        color: var(--nd-accent, #5dcaa5);
        font-family: inherit; font-size: 13px; font-weight: bold;
        padding: 8px 20px; border-radius: 4px; cursor: pointer;
        transition: background 0.15s, box-shadow 0.15s;
        letter-spacing: 0.04em;
      }
      .nd-tut-next:hover {
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 30%, transparent);
        box-shadow: 0 0 12px color-mix(in srgb, var(--nd-accent, #5dcaa5) 25%, transparent);
      }
      .nd-tut-card::-webkit-scrollbar { width: 6px; }
      .nd-tut-card::-webkit-scrollbar-track { background: transparent; }
      .nd-tut-card::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 30%, transparent);
        border-radius: 3px;
      }
      .nd-tut-card::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, var(--nd-accent, #5dcaa5) 55%, transparent);
      }
    </style>`;
  }
}
