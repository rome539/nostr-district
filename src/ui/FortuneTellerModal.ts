/**
 * FortuneTellerModal.ts
 * Full-screen mystic overlay shown when interacting with the alley fortune teller.
 * Coin drop animation → crystal ball glow → typewriter fortune reveal.
 */

const FORTUNES = [
  "A change is coming. You will not see it until it has already arrived.",
  "The answer you seek is already known to you. You are afraid of it.",
  "Someone is thinking of you right now. They won't say so.",
  "What you are running from is lighter than what you are running toward.",
  "A door you closed is still unlocked.",
  "The risk you have been avoiding will cost more to avoid than to take.",
  "Not all silence is emptiness. Some of it is listening.",
  "You will meet someone unexpected. Pay attention to what they don't say.",
  "The thing you lost was not as valuable as what you found looking for it.",
  "Your instinct was right the first time.",
  "Rest is not surrender. Even fire needs air.",
  "An old wound is closer to healed than you think.",
  "You have been the stranger in someone else's story. They remember you kindly.",
  "The version of yourself from three years ago would be proud. And a little surprised.",
  "Something is ending. Something is beginning. They are the same thing.",
  "Stop waiting for permission.",
  "The answer is simpler than the question makes it sound.",
  "Not everything that follows you is a threat. Some things are just curious.",
  "You are further along than it feels.",
  "The next time you laugh, let it be louder than usual.",
  "A small kindness you showed was remembered longer than you know.",
  "The conversation you have been putting off will go better than you expect.",
  "You have outgrown something you have not yet put down.",
  "Someone you underestimated is about to surprise you.",
  "The path that looks harder is the one that fits you.",
  "What kept you up last night will seem smaller by the weekend.",
  "You have already made the right decision. Now you just need to commit to it.",
  "Patience is not the same as doing nothing.",
  "The thing you keep almost saying — say it.",
  "Your presence in a room changes it more than you realize.",
  "A stranger's offhand comment will stay with you for years. Listen today.",
  "You have been measuring yourself against the wrong ruler.",
  "The longest part of any journey is convincing yourself to begin.",
  "Something you built quietly is stronger than it looks.",
  "The people who matter already know who you are.",
  "You are allowed to want more than you currently allow yourself.",
  "An apology you gave that was never acknowledged still counted.",
  "Not every chapter needs to end with a lesson. Some just end.",
  "You will find exactly what you need in an unexpected place.",
  "The friendship you have neglected is more resilient than you fear.",
  "A habit you started this month will matter greatly in a year.",
  "Someone nearby is waiting for you to ask for help.",
  "The version of the plan that scares you is probably the right one.",
  "You will be remembered for something you did not consider important.",
  "Your sense of direction is better than your confidence in it.",
  "The thing blocking you is not as solid as it looks from this side.",
  "Worry is just imagination pointing in the wrong direction.",
  "You are exactly where you need to be to get where you want to go.",
  "An old interest, revisited, will surprise you.",
  "The quiet ones in the room are often the ones worth knowing.",
  "You have been kind in ways no one saw. The universe did.",
  "Something you discarded too quickly deserves a second look.",
  "The answer to your question is hidden inside the question itself.",
  "A season of your life is ending. The next one is longer.",
  "You carry more than you admit to. Set some of it down.",
  "The dream you keep dismissing is trying to tell you something.",
  "Trust takes a long time to build and a moment to feel. You are close.",
  "What looks like a setback from here is a turn, not a stop.",
  "The best thing you can do today will seem insignificant at the time.",
  "You have survived every hard day so far. That is not nothing.",
];

let overlay: HTMLElement | null = null;
let onCloseCallback: (() => void) | null = null;

export const FortuneTellerModal = {
  show(onClose?: () => void): void {
    if (overlay) return;
    onCloseCallback = onClose ?? null;

    overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:9000;
      background:rgba(4,2,18,0.92);
      display:flex; align-items:center; justify-content:center;
      font-family:"Courier New",monospace;
      animation: ftFadeIn 0.4s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes ftFadeIn { from{opacity:0} to{opacity:1} }
      @keyframes ftGlow { 0%,100%{box-shadow:0 0 18px 6px #6633cc88, 0 0 40px 14px #3311aa44} 50%{box-shadow:0 0 28px 10px #aa66ff99, 0 0 60px 22px #5522cc55} }
      @keyframes ftPulse { 0%,100%{opacity:0.7; transform:scale(1)} 50%{opacity:1; transform:scale(1.04)} }
      @keyframes ftCoin { 0%{transform:translateY(-60px) rotateX(0deg); opacity:1} 80%{transform:translateY(0px) rotateX(720deg); opacity:1} 100%{transform:translateY(0px); opacity:0} }
      @keyframes ftReveal { from{opacity:0; letter-spacing:4px} to{opacity:1; letter-spacing:0.5px} }
      @keyframes ftStars { 0%,100%{opacity:0.3} 50%{opacity:0.9} }
    `;
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.style.cssText = `
      width:340px; max-width:92vw;
      background:linear-gradient(160deg,#0e0828 0%,#130c34 60%,#0a0620 100%);
      border:1px solid #5533aa66;
      border-radius:12px; padding:28px 24px 24px;
      text-align:center; position:relative; overflow:hidden;
    `;

    // Corner stars
    const stars = document.createElement('div');
    stars.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    stars.innerHTML = [
      [14,10],[320,10],[14,340],[320,340],
      [80,22],[260,18],[50,160],[300,200],[170,14],
    ].map(([sx,sy]) =>
      `<div style="position:absolute;left:${sx}px;top:${sy}px;width:${1+Math.random()*2}px;height:${1+Math.random()*2}px;background:#c0a0ff;border-radius:50%;animation:ftStars ${1.5+Math.random()*2}s ${Math.random()}s ease-in-out infinite;opacity:0.5;"></div>`
    ).join('');
    box.appendChild(stars);

    // Title
    const title = document.createElement('div');
    title.textContent = '✦ MADAME ZARA ✦';
    title.style.cssText = 'color:#c0a0ff;font-size:11px;letter-spacing:3px;margin-bottom:18px;opacity:0.8;';
    box.appendChild(title);

    // Crystal ball
    const ballWrap = document.createElement('div');
    ballWrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:16px;';
    const ball = document.createElement('div');
    ball.style.cssText = `
      width:72px; height:72px; border-radius:50%;
      background:radial-gradient(circle at 35% 30%, #9966ee, #4422aa 55%, #1a0a44);
      animation:ftGlow 2.4s ease-in-out infinite;
      position:relative; cursor:default;
    `;
    // Ball highlight
    const shine = document.createElement('div');
    shine.style.cssText = `
      position:absolute; top:14px; left:16px;
      width:18px; height:12px; border-radius:50%;
      background:rgba(255,255,255,0.18);
      transform:rotate(-30deg);
    `;
    ball.appendChild(shine);
    ballWrap.appendChild(ball);
    box.appendChild(ballWrap);

    // Coin animation
    const coin = document.createElement('div');
    coin.textContent = '🪙';
    coin.style.cssText = `
      font-size:20px; display:block; margin:-8px auto 12px;
      animation: ftCoin 0.9s 0.3s ease-in both;
    `;
    box.appendChild(coin);

    // Status / fortune text
    const status = document.createElement('div');
    status.textContent = 'The machine hums...';
    status.style.cssText = `
      color:#9977cc; font-size:10px; letter-spacing:1px;
      min-height:64px; line-height:1.7; padding:0 8px;
      animation:ftPulse 1.6s ease-in-out infinite;
    `;
    box.appendChild(status);

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'border-top:1px solid #3322664a;margin:16px 0 12px;';
    box.appendChild(div);

    // Dismiss hint
    const hint = document.createElement('div');
    hint.textContent = '[ESC] or click to close';
    hint.style.cssText = 'color:#5544884a;font-size:9px;letter-spacing:1px;cursor:pointer;';
    hint.onclick = () => FortuneTellerModal.destroy();
    box.appendChild(hint);

    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) FortuneTellerModal.destroy(); });
    document.body.appendChild(overlay);
    document.head.appendChild(style);

    // After coin lands, reveal fortune
    setTimeout(() => {
      const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
      status.style.animation = '';
      status.style.color = '#d0b8ff';
      status.style.fontSize = '11px';
      status.style.letterSpacing = '0.5px';
      typewrite(status, `"${fortune}"`, 28);
    }, 1300);
  },

  destroy(): void {
    if (!overlay) return;
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
    }, 300);
    onCloseCallback?.();
    onCloseCallback = null;
  },

  isOpen(): boolean { return overlay !== null; },
};

function typewrite(el: HTMLElement, text: string, msPerChar: number): void {
  el.textContent = '';
  let i = 0;
  const tick = () => {
    if (i < text.length) { el.textContent += text[i++]; setTimeout(tick, msPerChar); }
  };
  tick();
}
