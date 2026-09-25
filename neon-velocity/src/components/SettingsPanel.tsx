/**
 * Настройки: звук и громкость, тряска экрана, счётчик FPS, статус сохранения
 * и сброс прогресса с подтверждением прямо в панели — два шага, без confirm().
 * Esc во время подтверждения отменяет его, а не закрывает панель.
 */
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import {
  Activity,
  AudioLines,
  CircleCheck,
  Database,
  Music,
  RotateCcw,
  Settings2,
  ShieldAlert,
  TriangleAlert,
  Trash2,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SKIN_ORDER, THEME_ORDER, UPGRADE_ORDER } from '../game/config';
import type { SaveData } from '../game/types';
import { playUiSound } from '../game/uiSound';
import type { ProgressActions } from '../state/useProgress';
import { STARTING_CRYSTALS } from '../state/storage';
import './menu/menu.css';
import { EASE_OUT } from './menu/shared';
import { ShopButton } from './menu/ShopButton';
import { SwitchRow } from './menu/Switch';
import { useDialogFocus } from './menu/useDialogFocus';
import { VolumeSlider } from './menu/VolumeSlider';
import { CrystalCount } from './ui/CrystalCount';
import { formatNumber } from './ui/format';
import { Overlay } from './ui/Overlay';
import { Panel } from './ui/Panel';

export interface SettingsPanelProps {
  save: SaveData;
  actions: ProgressActions;
  storageOk: boolean;
  onClose(): void;
}

type ResetStep = 'idle' | 'confirm' | 'done';

/** Сколько секунд живёт подтверждение сброса, прежде чем отмениться само. */
const CONFIRM_SECONDS = 8;
/** Сколько показывать «Прогресс сброшен». */
const DONE_MS = 3200;

const sections: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const sectionItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE_OUT } },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.section variants={sectionItem} className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-ink-dim">
        <span aria-hidden className="h-px w-3 bg-theme-a shadow-[0_0_6px_var(--theme-a)]" />
        {title}
      </h3>
      {children}
    </motion.section>
  );
}

/** Что именно потеряется при сбросе — чтобы подтверждение было осознанным. */
function LossSummary({ save }: { save: SaveData }) {
  const bought = save.ownedSkins.length - 1 + (save.ownedThemes.length - 1);
  const tiers = UPGRADE_ORDER.reduce((n, id) => n + save.upgrades[id], 0);
  const items: { label: string; value: ReactNode }[] = [
    { label: 'Кошелёк', value: <CrystalCount value={save.crystals} size="sm" /> },
    { label: 'Рекорд', value: <span className="text-neon-yellow">{formatNumber(save.highscore)}</span> },
    {
      label: 'Покупки',
      value: (
        <span className="text-ink">
          {bought} из {SKIN_ORDER.length + THEME_ORDER.length - 2}
        </span>
      ),
    },
    { label: 'Улучшения', value: <span className="text-ink">{tiers} ур.</span> },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[3px] border border-neon-red/20 bg-void/60 px-3 py-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col">
          <dt className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint">{it.label}</dt>
          <dd className="nvm-digits truncate text-xs font-bold">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Звук, громкость, тряска, FPS, сброс прогресса. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function SettingsPanel({ save, actions, storageOk, onClose }: SettingsPanelProps) {
  const { settings } = save;
  const [step, setStep] = useState<ResetStep>('idle');
  const anchor = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmBoxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(anchor);

  // Подтверждение отменяется само, если его оставить; «сброшено» — гаснет.
  useEffect(() => {
    if (step === 'idle') return;
    const t = setTimeout(() => setStep('idle'), step === 'confirm' ? CONFIRM_SECONDS * 1000 : DONE_MS);
    return () => clearTimeout(t);
  }, [step]);

  // Esc при открытом подтверждении — отмена. Слушатель в фазе захвата срабатывает
  // раньше App, а preventDefault говорит App не закрывать панель.
  useEffect(() => {
    if (step !== 'confirm') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      playUiSound('back');
      setStep('idle');
      resetRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  // Фокус следует за шагом: на безопасную «Отмену» в подтверждении.
  useEffect(() => {
    if (step === 'confirm') cancelRef.current?.focus({ preventScroll: true });
  }, [step]);

  const askReset = () => {
    playUiSound('error');
    setStep('confirm');
  };

  const cancelReset = () => {
    playUiSound('back');
    setStep('idle');
    resetRef.current?.focus({ preventScroll: true });
  };

  const confirmReset = () => {
    actions.resetProgress();
    playUiSound('back');
    setStep('done');
    resetRef.current?.focus({ preventScroll: true });
  };

  const previewSfx = () => playUiSound('click');

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Настройки">
      <Panel
        title="Настройки"
        subtitle="Звук, экран и сохранение прогресса"
        icon={Settings2}
        accent="cyan"
        width="lg"
        onClose={onClose}
      >
        <motion.div ref={anchor} variants={sections} initial="hidden" animate="show" className="flex flex-col gap-5">
          <Section title="Звук">
            <SwitchRow
              icon={settings.sound ? Volume2 : VolumeX}
              label="Звук"
              description="Синтвейв-саундтрек в ритме игры и звуки интерфейса"
              checked={settings.sound}
              onChange={(sound) => actions.updateSettings({ sound })}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <VolumeSlider
                icon={Music}
                label="Музыка"
                value={settings.music}
                color="#ff2bd6"
                muted={!settings.sound}
                onChange={(music) => actions.updateSettings({ music })}
              />
              <VolumeSlider
                icon={AudioLines}
                label="Эффекты"
                value={settings.sfx}
                color="#22f0ff"
                muted={!settings.sound}
                onChange={(sfx) => actions.updateSettings({ sfx })}
                onCommit={previewSfx}
              />
            </div>
          </Section>

          <Section title="Экран">
            <SwitchRow
              icon={Vibrate}
              label="Тряска экрана"
              description="При столкновениях, взрыве и новом уровне скорости"
              checked={settings.screenShake}
              onChange={(screenShake) => actions.updateSettings({ screenShake })}
            />
            <SwitchRow
              icon={Activity}
              label="Счётчик FPS"
              description="Кадры в секунду в углу экрана во время забега"
              checked={settings.showFps}
              onChange={(showFps) => actions.updateSettings({ showFps })}
            />
          </Section>

          <Section title="Сохранение">
            <div
              role="status"
              className={[
                'flex items-start gap-3 rounded-[3px] border px-3 py-2.5 sm:px-4',
                storageOk ? 'border-neon-green/30 bg-neon-green/[0.05]' : 'border-neon-red/45 bg-neon-red/[0.07]',
              ].join(' ')}
            >
              <span
                className={[
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border',
                  storageOk ? 'border-neon-green/40 text-neon-green' : 'border-neon-red/50 text-neon-red',
                ].join(' ')}
              >
                {storageOk ? <Database size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
              </span>
              <span className="min-w-0 text-[11px] leading-snug text-ink-dim">
                <span
                  className={`block text-xs font-bold uppercase tracking-widest ${storageOk ? 'text-neon-green' : 'text-neon-red'}`}
                >
                  {storageOk ? 'Автосохранение включено' : 'Сохранение недоступно'}
                </span>
                {storageOk
                  ? 'Кристаллы, покупки, рекорды и настройки сохраняются в этом браузере после каждого изменения.'
                  : 'Браузер запретил localStorage (приватный режим или настройки сайта). Прогресс проживёт только до перезагрузки страницы.'}
              </span>
            </div>
          </Section>

          <Section title="Опасная зона">
            <div className="rounded-[3px] border border-neon-red/25 bg-neon-red/[0.03] px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink">
                    <ShieldAlert size={14} className="text-neon-red" aria-hidden />
                    Сброс прогресса
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">
                    Кошелёк, покупки, улучшения, рекорды и статистика — с нуля. Настройки останутся.
                  </span>
                </div>
                <ShopButton
                  ref={resetRef}
                  tone={step === 'confirm' ? 'locked' : 'red'}
                  icon={RotateCcw}
                  inactive={step === 'confirm'}
                  aria-expanded={step === 'confirm'}
                  onClick={() => {
                    if (step !== 'confirm') askReset();
                  }}
                >
                  Сбросить
                </ShopButton>
              </div>

              <AnimatePresence initial={false}>
                {step === 'confirm' && (
                  <motion.div
                    key="confirm"
                    role="alertdialog"
                    aria-label="Подтверждение сброса прогресса"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.28, ease: EASE_OUT }}
                    // Когда блок раскрылся, докрутить панель, чтобы кнопки подтверждения были видны.
                    onAnimationComplete={() => confirmBoxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                    className="overflow-hidden"
                  >
                    <div
                      ref={confirmBoxRef}
                      className="mt-3 flex flex-col gap-3 rounded-[3px] border border-neon-red/60 bg-void/70 p-3 shadow-[0_0_18px_rgba(255,59,107,0.25),inset_0_0_14px_rgba(255,59,107,0.12)]"
                    >
                      <p className="flex items-start gap-2 text-xs leading-snug text-ink">
                        <TriangleAlert size={16} className="mt-px shrink-0 text-neon-red" aria-hidden />
                        <span>
                          <b className="font-bold uppercase tracking-wider text-neon-red text-glow-red">Точно сбросить?</b> Это
                          нельзя отменить. Останется только стартовый подарок —{' '}
                          <span className="whitespace-nowrap text-neon-cyan">{STARTING_CRYSTALS} кристаллов</span>.
                        </span>
                      </p>
                      <LossSummary save={save} />
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ShopButton ref={cancelRef} tone="ghost" onClick={cancelReset}>
                          Отмена
                        </ShopButton>
                        <ShopButton tone="red" icon={Trash2} onClick={confirmReset}>
                          Да, сбросить
                        </ShopButton>
                      </div>
                      {/* Полоса до автоматической отмены. */}
                      <span aria-hidden className="block h-0.5 w-full overflow-hidden rounded-full bg-white/5">
                        <span
                          className="nvm-countdown block h-full w-full bg-neon-red shadow-[0_0_8px_#ff3b6b]"
                          style={{ ['--nvm-countdown' as string]: `${CONFIRM_SECONDS}s` }}
                        />
                      </span>
                    </div>
                  </motion.div>
                )}
                {step === 'done' && (
                  <motion.p
                    key="done"
                    role="status"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-3 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-neon-green"
                  >
                    <CircleCheck size={15} aria-hidden />
                    Прогресс сброшен. Стартовые {STARTING_CRYSTALS} кристаллов уже в кошельке.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </Section>
        </motion.div>
      </Panel>
    </Overlay>
  );
}
