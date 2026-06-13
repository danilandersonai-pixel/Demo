// Точка входа: конфигурация Phaser 4 и запуск игры «ЭХО-7».

import BootScene from './scenes/BootScene.js';
import WorldScene from './scenes/WorldScene.js';
import UIScene from './scenes/UIScene.js';

const config = {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a241f',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 540
    },
    physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 }, debug: false }
    },
    render: { antialias: true, roundPixels: true },
    scene: [BootScene, WorldScene, UIScene]
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
