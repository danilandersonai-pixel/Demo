// WorldScene — основной геймплей: открытый мир, робот, камера,
// точки памяти, взаимодействие и компас к ближайшей неоткрытой точке.

import { POIS, INTRO_LINES, ENDING_LINES, ROBOT_NAME } from '../data/lore.js';

const WORLD = { w: 4000, h: 3200 };
const SPEED = 150;
const INTERACT_RADIUS = 78;
const SAVE_KEY = 'echo7-progress';

// kind -> ключ текстуры (для большинства совпадает)
const TEX = {
    pod: 'pod', ruin: 'ruin', tree: 'tree', toy: 'toy',
    robot: 'dormant', archive: 'archive', garden: 'garden', tower: 'tower'
};
// какие точки физически твёрдые (об них нельзя пройти)
const SOLID_KINDS = new Set(['pod', 'ruin', 'robot', 'archive', 'garden', 'tower']);

export default class WorldScene extends Phaser.Scene {
    constructor() {
        super('WorldScene');
    }

    create() {
        this.discovered = this.loadProgress();
        this.dialogActive = false;
        this.activePoi = null;

        // Фон-земля, замощённая тайлом на весь мир.
        this.add.tileSprite(0, 0, WORLD.w, WORLD.h, 'ground')
            .setOrigin(0, 0)
            .setDepth(-100);

        this.physics.world.setBounds(0, 0, WORLD.w, WORLD.h);
        this.cameras.main.setBounds(0, 0, WORLD.w, WORLD.h);

        this.solids = this.physics.add.staticGroup();

        this.scatterDecor();
        this.spawnPois();
        this.createPlayer();
        this.createCompass();

        this.physics.add.collider(this.player, this.solids);

        // Камера следует за роботом с плавностью и мёртвой зоной.
        const cam = this.cameras.main;
        cam.startFollow(this.player, true, 0.09, 0.09);
        cam.setZoom(1.6);
        cam.setDeadzone(120, 90);

        // Ввод.
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keys = this.input.keyboard.addKeys('W,A,S,D,E');

        // Параллельный UI.
        this.scene.launch('UIScene');
        this.scene.bringToTop('UIScene');

        // Связь с UIScene.
        this.game.events.on('dialogue-complete', this.onDialogueComplete, this);
        this.events.once('shutdown', () => {
            this.game.events.off('dialogue-complete', this.onDialogueComplete, this);
        });

        // Сообщаем стартовый прогресс и (один раз) играем вступление.
        this.time.delayedCall(60, () => {
            this.emitProgress();
            if (this.discovered.size === 0) {
                this.openDialogue(`Пробуждение · ${ROBOT_NAME}`, INTRO_LINES, null);
            } else {
                this.toast(`С возвращением, ${ROBOT_NAME}. Найдено точек: ${this.discovered.size}/${POIS.length}.`);
            }
        });
    }

    // ---- построение мира -------------------------------------------------

    scatterDecor() {
        // Деревья и камни (твёрдые) + цветы (проходимые) случайно по миру,
        // избегая зоны рядом с точками интереса.
        const avoid = POIS.map(p => new Phaser.Math.Vector2(centerX(p), centerY(p)));
        const farFromPois = (x, y, d) => avoid.every(v => Phaser.Math.Distance.Between(x, y, v.x, v.y) > d);

        for (let i = 0; i < 90; i++) {
            const x = Phaser.Math.Between(80, WORLD.w - 80);
            const y = Phaser.Math.Between(80, WORLD.h - 80);
            if (!farFromPois(x, y, 130)) continue;
            const t = this.solids.create(x, y, 'tree');
            t.setDepth(y);
            t.refreshBody();
            // узкое тело у основания ствола
            t.body.setSize(14, 14).setOffset(t.width / 2 - 7, t.height - 16);
        }
        for (let i = 0; i < 50; i++) {
            const x = Phaser.Math.Between(60, WORLD.w - 60);
            const y = Phaser.Math.Between(60, WORLD.h - 60);
            if (!farFromPois(x, y, 90)) continue;
            const r = this.solids.create(x, y, 'rock');
            r.setDepth(y);
            r.refreshBody();
            r.body.setSize(30, 16).setOffset(5, 12);
        }
        for (let i = 0; i < 160; i++) {
            const x = Phaser.Math.Between(40, WORLD.w - 40);
            const y = Phaser.Math.Between(40, WORLD.h - 40);
            this.add.image(x, y, 'flower').setDepth(y - 4).setAlpha(0.95);
        }
    }

    spawnPois() {
        this.pois = [];
        for (const poi of POIS) {
            const cx = centerX(poi);
            const cy = centerY(poi);

            // мягкое свечение под точкой
            const glow = this.add.image(cx, cy, 'glow').setDepth(cy - 30).setAlpha(0.9);
            this.tweens.add({
                targets: glow, alpha: { from: 0.4, to: 1 }, scale: { from: 0.9, to: 1.15 },
                duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.inOut'
            });

            const key = TEX[poi.kind] || poi.kind;
            let sprite;
            if (SOLID_KINDS.has(poi.kind)) {
                sprite = this.solids.create(cx, cy, key);
                sprite.refreshBody();
                sprite.body.setSize(sprite.width * 0.8, sprite.height * 0.5)
                    .setOffset(sprite.width * 0.1, sprite.height * 0.5);
            } else {
                sprite = this.add.image(cx, cy, key);
            }
            sprite.setDepth(cy);

            const rec = { poi, sprite, glow, cx, cy };
            this.pois.push(rec);
            this.markDiscoveredVisual(rec);
        }
    }

    createPlayer() {
        const start = POIS.find(p => p.id === 'crib');
        this.player = this.physics.add.sprite(centerX(start) + 70, centerY(start) + 70, 'robot');
        this.player.setDepth(this.player.y);
        this.player.body.setSize(20, 16).setOffset(7, 26);
        this.player.setCollideWorldBounds(true);

        // лёгкое «дыхание» корпуса
        this.tweens.add({
            targets: this.player, scaleY: { from: 1, to: 0.96 },
            duration: 520, yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });

        // пыль из-под ног при движении
        this.dust = this.add.particles(0, 0, 'dust', {
            speed: { min: 6, max: 22 }, scale: { start: 0.5, end: 0 },
            alpha: { start: 0.5, end: 0 }, lifespan: 500, frequency: -1, tint: 0xcfc7b0
        });
        this.dust.setDepth(this.player.y - 1);
    }

    createCompass() {
        // Маленькая стрелка-указатель, вращается вокруг робота к цели.
        this.compass = this.add.triangle(0, 0, 0, -7, 6, 7, -6, 7, 0x66f0d8)
            .setDepth(99999).setAlpha(0.85);
    }

    // ---- взаимодействие --------------------------------------------------

    update() {
        this.player.setDepth(this.player.y);
        this.dust.setDepth(this.player.y - 1);

        if (this.dialogActive) {
            this.player.setVelocity(0, 0);
            this.dust.stop();
            this.updateCompass(false);
            return;
        }

        this.handleMovement();
        this.handleInteraction();
    }

    handleMovement() {
        const k = this.keys;
        const c = this.cursors;
        let vx = 0, vy = 0;
        if (c.left.isDown || k.A.isDown) vx -= 1;
        if (c.right.isDown || k.D.isDown) vx += 1;
        if (c.up.isDown || k.W.isDown) vy -= 1;
        if (c.down.isDown || k.S.isDown) vy += 1;

        const moving = vx !== 0 || vy !== 0;
        if (moving) {
            const len = Math.hypot(vx, vy);
            this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);
            if (vx !== 0) this.player.setFlipX(vx < 0);
            this.dust.emitParticleAt(this.player.x, this.player.y + 18);
        } else {
            this.player.setVelocity(0, 0);
        }
    }

    handleInteraction() {
        // ближайшая точка в радиусе
        let nearest = null, nd = Infinity;
        for (const rec of this.pois) {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, rec.cx, rec.cy);
            if (d < nd) { nd = d; nearest = rec; }
        }
        const inRange = nearest && nd <= INTERACT_RADIUS;
        this.activePoi = inRange ? nearest : null;

        this.game.events.emit('prompt', inRange
            ? { text: this.promptText(nearest), x: nearest.cx, y: nearest.cy }
            : null);

        if (inRange && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
            this.interact(nearest);
        }
        this.updateCompass(true);
    }

    promptText(rec) {
        const done = this.discovered.has(rec.poi.id);
        if (rec.poi.id === 'tower' && this.allButTowerDone() && this.discovered.has('tower')) {
            return '[E] подвести итог';
        }
        return done ? '[E] осмотреть снова' : '[E] осмотреть';
    }

    interact(rec) {
        const poi = rec.poi;
        // финал: башня после того, как всё остальное найдено
        if (poi.id === 'tower' && this.discovered.has('tower') && this.allButTowerDone()) {
            this.openDialogue('Итог пути', ENDING_LINES, null);
            return;
        }
        const firstTime = !this.discovered.has(poi.id);
        this.openDialogue(poi.title, poi.lines, firstTime ? poi.id : null);
        if (firstTime) {
            this.discovered.add(poi.id);
            this.saveProgress();
            this.markDiscoveredVisual(rec);
            this.emitProgress();
        }
    }

    markDiscoveredVisual(rec) {
        if (this.discovered.has(rec.poi.id)) {
            rec.glow.setAlpha(0.2);
            this.tweens.killTweensOf(rec.glow);
            rec.glow.setScale(1).setTint(0x6b7c80);
        }
    }

    allButTowerDone() {
        return POIS.filter(p => p.id !== 'tower').every(p => this.discovered.has(p.id));
    }

    openDialogue(title, lines, poiId) {
        this.dialogActive = true;
        this.game.events.emit('dialogue', { title, lines });
    }

    onDialogueComplete() {
        this.dialogActive = false;
    }

    // ---- компас ----------------------------------------------------------

    updateCompass(visible) {
        const target = this.nearestUndiscovered();
        if (!visible || !target) {
            this.compass.setVisible(false);
            if (!target && !this._allToast && this.discovered.size >= POIS.length) {
                this._allToast = true;
                this.toast('Все точки памяти найдены. Вернись к обсерватории за итогом.');
            }
            return;
        }
        const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.cx, target.cy);
        const rad = 48;
        this.compass
            .setVisible(true)
            .setPosition(this.player.x + Math.cos(ang) * rad, this.player.y + Math.sin(ang) * rad - 6)
            .setRotation(ang + Math.PI / 2)
            .setDepth(this.player.y + 50);
    }

    nearestUndiscovered() {
        let best = null, bd = Infinity;
        for (const rec of this.pois) {
            if (this.discovered.has(rec.poi.id)) continue;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, rec.cx, rec.cy);
            if (d < bd) { bd = d; best = rec; }
        }
        return best;
    }

    // ---- утилиты ---------------------------------------------------------

    emitProgress() {
        this.game.events.emit('progress', { found: this.discovered.size, total: POIS.length });
    }

    toast(text) {
        this.game.events.emit('toast', text);
    }

    loadProgress() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            return new Set(raw ? JSON.parse(raw) : []);
        } catch (e) {
            return new Set();
        }
    }

    saveProgress() {
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify([...this.discovered]));
        } catch (e) { /* приватный режим — просто не сохраняем */ }
    }
}

// Якорь — капсула пробуждения в центре мира; остальные точки смещены от неё.
function centerX(poi) { return WORLD.w / 2 + poi.x; }
function centerY(poi) { return WORLD.h / 2 + poi.y; }
