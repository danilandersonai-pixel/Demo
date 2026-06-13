// BootScene — генерирует все текстуры процедурно с помощью Graphics,
// чтобы игра не зависела от внешних ассетов и работала офлайн.
// После генерации запускает WorldScene.

export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    create() {
        this.makeGround();
        this.makeRobot();
        this.makeDust();
        this.makeTree();
        this.makeRuin();
        this.makePod();
        this.makeToy();
        this.makeDormant();
        this.makeArchive();
        this.makeGarden();
        this.makeTower();
        this.makeRock();
        this.makeFlower();
        this.makeGlow();

        this.scene.start('WorldScene');
    }

    // Вспомогательная обёртка: рисуем во временный Graphics и пекём в текстуру.
    bake(key, width, height, drawFn) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        drawFn(g);
        g.generateTexture(key, width, height);
        g.destroy();
    }

    makeGround() {
        // Тайл травы 64x64 с лёгким шумом, поверх — пятна бетона/земли.
        this.bake('ground', 64, 64, (g) => {
            g.fillStyle(0x35502f, 1);
            g.fillRect(0, 0, 64, 64);
            for (let i = 0; i < 120; i++) {
                const x = Phaser.Math.Between(0, 63);
                const y = Phaser.Math.Between(0, 63);
                const shade = Phaser.Math.RND.pick([0x2c4427, 0x3d5b35, 0x415f38]);
                g.fillStyle(shade, 0.6);
                g.fillRect(x, y, Phaser.Math.Between(1, 3), Phaser.Math.Between(1, 3));
            }
        });
    }

    makeRobot() {
        // Корпус робота ЭХО-7: тело, голова, светящийся глаз, антенна.
        this.bake('robot', 34, 44, (g) => {
            // тень-ноги
            g.fillStyle(0x222a2e, 1);
            g.fillRoundedRect(8, 30, 8, 12, 2);
            g.fillRoundedRect(18, 30, 8, 12, 2);
            // тело
            g.fillStyle(0x9aa7ad, 1);
            g.fillRoundedRect(6, 14, 22, 20, 5);
            g.fillStyle(0x7e8b91, 1);
            g.fillRoundedRect(6, 26, 22, 8, 5);
            // нагрудная панель
            g.fillStyle(0x3a8f7a, 1);
            g.fillRoundedRect(12, 18, 10, 8, 2);
            // голова
            g.fillStyle(0xc2ced3, 1);
            g.fillRoundedRect(9, 2, 16, 14, 4);
            // глаз
            g.fillStyle(0x10242a, 1);
            g.fillRoundedRect(11, 6, 12, 6, 3);
            g.fillStyle(0x66f0d8, 1);
            g.fillCircle(17, 9, 2.4);
            // антенна
            g.lineStyle(2, 0x7e8b91, 1);
            g.beginPath();
            g.moveTo(17, 2);
            g.lineTo(17, -4 + 4);
            g.strokePath();
            g.fillStyle(0xff6b6b, 1);
            g.fillCircle(17, 1, 1.6);
        });
    }

    makeDust() {
        this.bake('dust', 8, 8, (g) => {
            g.fillStyle(0xd9d2c0, 1);
            g.fillCircle(4, 4, 3);
        });
    }

    makeGlow() {
        // Мягкое радиальное свечение для подсветки точек интереса.
        this.bake('glow', 96, 96, (g) => {
            for (let r = 48; r > 0; r -= 2) {
                g.fillStyle(0x66f0d8, 0.03);
                g.fillCircle(48, 48, r);
            }
        });
    }

    makeTree() {
        this.bake('tree', 64, 84, (g) => {
            g.fillStyle(0x3b2c20, 1);
            g.fillRect(28, 52, 8, 30);
            g.fillStyle(0x2f5d34, 1);
            g.fillCircle(32, 36, 26);
            g.fillStyle(0x3c7340, 1);
            g.fillCircle(22, 30, 16);
            g.fillCircle(44, 32, 15);
            g.fillStyle(0x4a8a4e, 0.8);
            g.fillCircle(30, 24, 12);
        });
    }

    makeRuin() {
        this.bake('ruin', 96, 76, (g) => {
            g.fillStyle(0x6b6f73, 1);
            g.fillRect(6, 28, 84, 48);
            g.fillStyle(0x55585b, 1);
            g.fillRect(6, 28, 84, 10);
            // пролом
            g.fillStyle(0x1c2226, 1);
            g.fillRect(20, 44, 22, 32);
            g.fillRect(58, 50, 24, 26);
            // трещины
            g.lineStyle(2, 0x3f4346, 1);
            g.beginPath();
            g.moveTo(50, 28); g.lineTo(46, 60); g.lineTo(52, 76);
            g.strokePath();
            // мох
            g.fillStyle(0x4a8a4e, 0.7);
            g.fillRect(6, 28, 84, 4);
        });
    }

    makePod() {
        this.bake('pod', 60, 72, (g) => {
            g.fillStyle(0x4b5358, 1);
            g.fillRoundedRect(8, 8, 44, 60, 10);
            g.fillStyle(0x2a3438, 1);
            g.fillRoundedRect(16, 16, 28, 40, 6);
            g.fillStyle(0x66f0d8, 0.25);
            g.fillRoundedRect(16, 16, 28, 40, 6);
            g.fillStyle(0xff8a5b, 1);
            g.fillCircle(30, 62, 3);
            g.lineStyle(2, 0x6b7378, 1);
            g.strokeRoundedRect(8, 8, 44, 60, 10);
        });
    }

    makeToy() {
        this.bake('toy', 32, 32, (g) => {
            g.fillStyle(0x9c6b3f, 1);
            g.fillCircle(16, 18, 9);
            g.fillCircle(16, 8, 6);
            g.fillCircle(9, 4, 3);
            g.fillCircle(23, 4, 3);
            g.fillStyle(0x111111, 1);
            g.fillCircle(13, 8, 1.2);
            g.fillStyle(0xfff3c4, 1);
            g.fillCircle(19, 8, 1.6); // блестящий глаз-пуговица
        });
    }

    makeDormant() {
        // Спящий робот — серая, тусклая версия игрока.
        this.bake('dormant', 34, 44, (g) => {
            g.fillStyle(0x4f575c, 1);
            g.fillRoundedRect(6, 14, 22, 20, 5);
            g.fillStyle(0x646d72, 1);
            g.fillRoundedRect(9, 2, 16, 14, 4);
            g.fillStyle(0x10181c, 1);
            g.fillRoundedRect(11, 6, 12, 6, 3);
            g.fillStyle(0x3a4145, 1);
            g.fillCircle(17, 9, 2.2); // погасший глаз
            g.fillStyle(0x3b2c20, 0.6);
            g.fillRect(6, 30, 22, 4); // ржавчина/грязь
        });
    }

    makeArchive() {
        this.bake('archive', 88, 70, (g) => {
            g.fillStyle(0x3c4a55, 1);
            g.fillRect(6, 14, 76, 56);
            g.fillStyle(0x2b353d, 1);
            g.fillRect(6, 14, 76, 8);
            // стойки серверов с огоньками
            for (let i = 0; i < 4; i++) {
                const x = 12 + i * 18;
                g.fillStyle(0x222a30, 1);
                g.fillRect(x, 26, 12, 40);
                g.fillStyle(Phaser.Math.RND.pick([0x66f0d8, 0xff8a5b, 0x8ad6ff]), 1);
                g.fillRect(x + 2, 30, 8, 2);
                g.fillRect(x + 2, 36, 8, 2);
            }
        });
    }

    makeGarden() {
        this.bake('garden', 96, 64, (g) => {
            g.fillStyle(0x5a4632, 1);
            g.fillRect(4, 20, 88, 40);
            // грядки
            g.fillStyle(0x4a3826, 1);
            for (let i = 0; i < 4; i++) g.fillRect(8, 24 + i * 9, 80, 4);
            // ростки
            for (let i = 0; i < 16; i++) {
                const x = Phaser.Math.Between(10, 86);
                const y = Phaser.Math.Between(24, 56);
                g.fillStyle(0x6cc24a, 1);
                g.fillRect(x, y, 2, 6);
                g.fillStyle(0x8ad65a, 1);
                g.fillCircle(x + 1, y, 2);
            }
        });
    }

    makeTower() {
        this.bake('tower', 80, 120, (g) => {
            g.fillStyle(0x5d6066, 1);
            g.fillRect(24, 30, 32, 90);
            g.fillStyle(0x4a4d52, 1);
            g.fillRect(24, 30, 32, 12);
            // купол обсерватории
            g.fillStyle(0x8a9aa3, 1);
            g.fillCircle(40, 30, 22);
            g.fillStyle(0x2a3236, 1);
            g.fillRect(36, 8, 8, 24); // прорезь телескопа
            g.fillStyle(0x66f0d8, 0.5);
            g.fillCircle(40, 30, 6);
        });
    }

    makeRock() {
        this.bake('rock', 40, 30, (g) => {
            g.fillStyle(0x6c7075, 1);
            g.fillEllipse(20, 18, 36, 22);
            g.fillStyle(0x595d61, 1);
            g.fillEllipse(14, 20, 18, 12);
            g.fillStyle(0x4a8a4e, 0.5);
            g.fillEllipse(24, 12, 14, 6);
        });
    }

    makeFlower() {
        this.bake('flower', 16, 16, (g) => {
            const petal = Phaser.Math.RND.pick([0xffd166, 0xf78fb3, 0xa0e7e5, 0xffffff]);
            g.fillStyle(petal, 1);
            for (let a = 0; a < 360; a += 72) {
                const r = Phaser.Math.DegToRad(a);
                g.fillCircle(8 + Math.cos(r) * 4, 8 + Math.sin(r) * 4, 3);
            }
            g.fillStyle(0xffe066, 1);
            g.fillCircle(8, 8, 2.4);
        });
    }
}
