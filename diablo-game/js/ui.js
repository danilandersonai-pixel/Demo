// HUD sync (DOM orbs/bars/buttons/log) + canvas overlays (damage text, rings).

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.depth = $('depth'); this.gold = $('gold'); this.plevel = $('plevel');
    this.xpfill = $('xpfill');
    this.hpfill = $('hpfill'); this.hptext = $('hptext');
    this.mpfill = $('mpfill'); this.mptext = $('mptext');
    this.btnPotion = $('btnPotion'); this.potionCount = $('potionCount');
    this.btnSpell = $('btnSpell');
    this.log = $('log');
    this._lastLog = 0;
  }

  syncDOM(game) {
    const p = game.player;
    this.depth.textContent = game.depth;
    this.gold.textContent = p.gold;
    this.plevel.textContent = p.level;
    this.xpfill.style.width = Math.max(0, Math.min(100, (p.xp / p.xpNext) * 100)) + '%';
    this.hpfill.style.height = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
    this.mpfill.style.height = Math.max(0, (p.mana / p.maxMana) * 100) + '%';
    this.hptext.textContent = Math.max(0, Math.ceil(p.hp));
    this.mptext.textContent = Math.max(0, Math.ceil(p.mana));
    this.potionCount.textContent = p.potions;
    this.btnPotion.classList.toggle('disabled', p.potions <= 0 || p.hp >= p.maxHp);
    this.btnSpell.classList.toggle('disabled', p.mana < p.spellCost);

    if (game.messages.length !== this._lastLog) {
      this._lastLog = game.messages.length;
      const recent = game.messages.slice(-4);
      this.log.innerHTML = recent.map((m) => `<div class="logline">${m.text}</div>`).join('');
    }
  }

  // Canvas overlays drawn above the lighting layer.
  drawOverlay(ctx, renderer, game) {
    const t = game.time;
    // destination marker
    if (game.marker && game.marker.life > 0) {
      const s = renderer.worldToScreen(game.marker.x, game.marker.y);
      const a = game.marker.life;
      ctx.strokeStyle = `rgba(120,220,140,${a})`;
      ctx.lineWidth = 2;
      const rr = 14 - a * 6;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, rr, rr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // target ring
    const tg = game.player.target;
    if (tg && tg.hp > 0) {
      const s = renderer.worldToScreen(tg.x, tg.y);
      ctx.strokeStyle = `rgba(220,80,60,${0.6 + 0.3 * Math.sin(t * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 16, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // floating combat text
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    for (const f of game.floatTexts) {
      const s = renderer.worldToScreen(f.x, f.y);
      const a = Math.min(1, f.life * 1.4);
      ctx.fillStyle = f.color.replace('ALPHA', a.toFixed(2));
      ctx.fillText(f.text, s.x, s.y - 30 - (1 - f.life) * 26);
    }
  }
}
