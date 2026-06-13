// UIScene — поверхность интерфейса поверх мира: счётчик прогресса,
// подсказки управления, всплывающая подсказка «[E]» у точек,
// тосты и диалоговое окно с эффектом печатной машинки.

export default class UIScene extends Phaser.Scene {
    constructor() {
        super('UIScene');
    }

    create() {
        const { width, height } = this.scale;
        const FONT = 'Verdana, Tahoma, sans-serif';

        // — HUD: прогресс —
        this.progress = this.add.text(16, 14, 'Точки памяти: 0/0', {
            fontFamily: FONT, fontSize: '16px', color: '#dfeae6',
            stroke: '#0c1416', strokeThickness: 4
        }).setScrollFactor(0).setDepth(10);

        // — нижняя подсказка управления —
        this.help = this.add.text(width / 2, height - 14,
            'WASD / стрелки — идти      E — осмотреть      ПРОБЕЛ — далее', {
            fontFamily: FONT, fontSize: '13px', color: '#9fb1ac',
            stroke: '#0c1416', strokeThickness: 3
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(10);

        // — подсказка «[E]» у точки (позиционируется в экранных координатах) —
        this.prompt = this.add.text(0, 0, '', {
            fontFamily: FONT, fontSize: '14px', color: '#66f0d8',
            backgroundColor: '#0e1c1fcc', padding: { x: 8, y: 4 }
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(20).setVisible(false);

        // — тост —
        this.toastText = this.add.text(width / 2, 54, '', {
            fontFamily: FONT, fontSize: '15px', color: '#ffe9c7',
            backgroundColor: '#0e1c1fcc', padding: { x: 10, y: 6 }, align: 'center'
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(20).setAlpha(0);

        // — диалоговое окно —
        this.buildDialogue(width, height, FONT);

        // ссылка на камеру мира — чтобы переводить мировые координаты в экранные
        this.worldCam = this.scene.get('WorldScene').cameras.main;

        // клавиши продвижения диалога
        this.advanceKeys = this.input.keyboard.addKeys('SPACE,ENTER');

        // — подписки на события из WorldScene —
        const g = this.game.events;
        g.on('progress', this.onProgress, this);
        g.on('prompt', this.onPrompt, this);
        g.on('toast', this.showToast, this);
        g.on('dialogue', this.onDialogue, this);
        this.events.once('shutdown', () => {
            g.off('progress', this.onProgress, this);
            g.off('prompt', this.onPrompt, this);
            g.off('toast', this.showToast, this);
            g.off('dialogue', this.onDialogue, this);
        });
    }

    buildDialogue(width, height, FONT) {
        const boxW = Math.min(width - 60, 720);
        const boxH = 150;
        const x = (width - boxW) / 2;
        const y = height - boxH - 36;

        this.dlg = this.add.container(0, 0).setScrollFactor(0).setDepth(50).setVisible(false);

        const bg = this.add.graphics();
        bg.fillStyle(0x0c181b, 0.92);
        bg.fillRoundedRect(x, y, boxW, boxH, 14);
        bg.lineStyle(2, 0x3a8f7a, 1);
        bg.strokeRoundedRect(x, y, boxW, boxH, 14);

        this.dlgTitle = this.add.text(x + 20, y + 14, '', {
            fontFamily: FONT, fontSize: '17px', color: '#66f0d8', fontStyle: 'bold'
        });
        this.dlgBody = this.add.text(x + 20, y + 46, '', {
            fontFamily: FONT, fontSize: '15px', color: '#e8efec',
            wordWrap: { width: boxW - 40 }, lineSpacing: 4
        });
        this.dlgMore = this.add.text(x + boxW - 16, y + boxH - 12, '▾ ПРОБЕЛ', {
            fontFamily: FONT, fontSize: '12px', color: '#7f938e'
        }).setOrigin(1, 1);

        this.dlg.add([bg, this.dlgTitle, this.dlgBody, this.dlgMore]);
    }

    // ---- обработчики событий ---------------------------------------------

    onProgress({ found, total }) {
        this.progress.setText(`Точки памяти: ${found}/${total}`);
    }

    onPrompt(data) {
        if (!data || this.dlg.visible) { this.prompt.setVisible(false); return; }
        // мир -> экран с учётом скролла и зума камеры мира
        const cam = this.worldCam;
        const sx = (data.x - cam.worldView.x) * cam.zoom;
        const sy = (data.y - cam.worldView.y) * cam.zoom;
        this.prompt.setText(data.text).setPosition(sx, sy - 52).setVisible(true);
    }

    showToast(text) {
        this.toastText.setText(text).setAlpha(0);
        this.tweens.killTweensOf(this.toastText);
        this.tweens.add({
            targets: this.toastText, alpha: 1, duration: 300,
            hold: 2600, yoyo: true,
            onComplete: () => this.toastText.setAlpha(0)
        });
    }

    onDialogue({ title, lines }) {
        this.lines = lines.slice();
        this.lineIdx = 0;
        this.dlgTitle.setText(title);
        this.prompt.setVisible(false);
        this.dlg.setVisible(true);
        this.typeLine();
    }

    typeLine() {
        const full = this.lines[this.lineIdx] || '';
        this.fullLine = full;
        this.typed = '';
        this.typing = true;
        this.dlgBody.setText('');
        this.dlgMore.setVisible(false);

        if (this.typeEvent) this.typeEvent.remove();
        this.typeEvent = this.time.addEvent({
            delay: 18, repeat: full.length - 1,
            callback: () => {
                this.typed = full.slice(0, this.typed.length + 1);
                this.dlgBody.setText(this.typed);
                if (this.typed.length >= full.length) {
                    this.typing = false;
                    this.dlgMore.setVisible(true);
                }
            }
        });
    }

    advance() {
        if (this.typing) {
            // дописать строку мгновенно
            if (this.typeEvent) this.typeEvent.remove();
            this.dlgBody.setText(this.fullLine);
            this.typing = false;
            this.dlgMore.setVisible(true);
            return;
        }
        this.lineIdx++;
        if (this.lineIdx >= this.lines.length) {
            this.closeDialogue();
        } else {
            this.typeLine();
        }
    }

    closeDialogue() {
        this.dlg.setVisible(false);
        if (this.typeEvent) this.typeEvent.remove();
        this.game.events.emit('dialogue-complete');
    }

    update() {
        if (!this.dlg.visible) return;
        if (Phaser.Input.Keyboard.JustDown(this.advanceKeys.SPACE) ||
            Phaser.Input.Keyboard.JustDown(this.advanceKeys.ENTER)) {
            this.advance();
        }
    }
}
