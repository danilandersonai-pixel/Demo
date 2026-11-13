/**
 * Настройки: звук и громкости, тряска экрана, счётчик FPS, статус сохранения и
 * сброс прогресса с подтверждением прямо в панели — два шага, без confirm().
 * Esc во время подтверждения отменяет его, а не закрывает панель.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AudioLines,
  CircleCheck,
  Database,
  Music,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audio } from '../audio/audio';
import { playUiSound } from '../audio/uiSound';
import { SKIN_ORDER, THEME_ORDER, UPGRADE_ORDER } from '../core/config';
import type { SaveData } from '../core/types';
import { STARTING_CRYSTALS } from '../state/storage';
import type { ProgressActions } from '../state/useProgress';
import { CrystalCount } from './kit/CrystalCount';
import { formatNumber, plural } from './kit/format';
import { Overlay } from './kit/Overlay';
import { Panel } from './kit/Panel';
import { useDialogFocus } from './kit/useDialogFocus';
import { ActionButton } from './menu/ActionButton';
import './menu/menu.css';
import { CRYSTAL_FORMS, EASE_OUT, stagger, staggerItem } from './menu/shared';
import { SwitchRow } from './menu/Switch';
import { VolumeSlider } from './menu/VolumeSlider';

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
const DONE_MS = 3600;

function Section({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <motion.section variants={staggerItem} className={['flex min-w-0 flex-col gap-2', className].join(' ')}>
      <h3 className="m-0 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-ink-dim">
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
    {
      label: 'Улучшения',
      value: (
        <span className="text-ink">
          {tiers} {plural(tiers, ['уровень', 'уровня', 'уровней'])}
        </span>
      ),
    },
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 rounded-[3px] border border-neon-red/20 bg-void/60 px-3 py-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-1 leading-none">
          <dt className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint">{it.label}</dt>
          <dd className="nvm-digits m-0 text-xs font-bold">{it.value}</dd>
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
  // Фокус — на прокручиваемом содержимом, а не на первом переключателе: зажатый
  // Enter, которым открыли панель, не должен щёлкать звуком туда-сюда.
  useDialogFocus(anchor, anchor);

  // Подтверждение отменяется само, если его оставить; «сброшено» — гаснет.
  useEffect(() => {
    if (step === 'idle') return;
    const timer = setTimeout(() => setStep('idle'), step === 'confirm' ? CONFIRM_SECONDS * 1000 : DONE_MS);
    return () => clearTimeout(timer);
  }, [step]);

  // Esc при открытом подтверждении — отмена, а не закрытие панели. Слушатель в фазе
  // захвата на window срабатывает раньше обработчика App, а остановка всплытия не
  // даёт тому закрыть панель; preventDefault — для обработчиков, которые смотрят на него.
  useEffect(() => {
    if (step !== 'confirm') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      playUiSound('back');
      setStep('idle');
      resetRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);

  // Фокус следует за шагом: в подтверждении — на безопасную «Отмену».
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

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Настройки">
      <Panel title="Настройки" subtitle="Звук, экран и сохранение прогресса" icon={Settings2} accent="cyan" width="lg" onClose={onClose}>
        {/* Телефон боком: две колонки — звук слева, экран справа; иначе панель в 390px
            высоты превращается в длинную ленту. */}
        <motion.div
          ref={anchor}
          tabIndex={-1}
          variants={stagger}
          initial="hidden"
          animate="show"
          className="nvm-focus-quiet grid grid-cols-1 gap-5 font-mono leading-normal [@media(max-height:560px)_and_(min-width:640px)]:grid-cols-2 [@media(max-height:560px)]:gap-4"
        >
          <Section title="Звук">
            <SwitchRow
              icon={settings.sound ? Volume2 : VolumeX}
              label="Звук"
              description="Синтвейв в ритме забега и звуки интерфейса"
              checked={settings.sound}
              onChange={(sound) => {
                // Щелчок-подтверждение включения — только в этой вкладке, не во всех открытых.
                if (sound) audio.armToggleConfirm();
                actions.updateSettings({ sound });
              }}
              silent
            />
            <div className="grid gap-2 sm:grid-cols-2 [@media(max-height:560px)]:grid-cols-1">
              <VolumeSlider
                icon={Music}
                label="Музыка"
                value={settings.music}
                color="var(--theme-a)"
                muted={!settings.sound}
                onChange={(music) => actions.updateSettings({ music })}
              />
              <VolumeSlider
                icon={AudioLines}
                label="Эффекты"
                value={settings.sfx}
                color="var(--theme-b)"
                muted={!settings.sound}
                onChange={(sfx) => actions.updateSettings({ sfx })}
                onCommit={() => playUiSound('click')}
              />
            </div>
          </Section>

          <Section title="Экран">
            <SwitchRow
              icon={Vibrate}
              label="Тряска экрана"
              description="При столкновении и на новом уровне скорости"
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

          <Section title="Сохранение" className="[@media(max-height:560px)_and_(min-width:640px)]:col-span-2">
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
                <span className={`block text-xs font-bold uppercase tracking-widest ${storageOk ? 'text-neon-green' : 'text-neon-red'}`}>
                  {storageOk ? 'Автосохранение включено' : 'Сохранение недоступно'}
                </span>
                {storageOk
                  ? 'Кристаллы, покупки, рекорды и настройки записываются в этом браузере после каждого изменения.'
                  : 'Браузер запретил localStorage (приватный режим или настройки сайта). Прогресс проживёт только до перезагрузки страницы.'}
              </span>
            </div>

            <div className="rounded-[3px] border border-neon-red/25 bg-neon-red/[0.03] px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-48">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-ink">
                    <ShieldAlert size={14} className="shrink-0 text-neon-red" aria-hidden />
                    Сброс прогресса
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">
                    Кошелёк, покупки, улучшения, рекорды и статистика — с нуля. Настройки останутся.
                  </span>
                </div>
                <ActionButton
                  ref={resetRef}
                  tone={step === 'confirm' ? 'ghost' : 'danger'}
                  icon={RotateCcw}
                  passive={step === 'confirm'}
                  aria-expanded={step === 'confirm'}
                  sound={null}
                  onClick={askReset}
                >
                  Сбросить
                </ActionButton>
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
                    // Когда блок раскрылся, докрутить панель: кнопки подтверждения должны быть видны.
                    onAnimationComplete={() => confirmBoxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                    className="overflow-hidden"
                  >
                    <div
                      ref={confirmBoxRef}
                      className="mt-3 flex flex-col gap-3 rounded-[3px] border border-neon-red/60 bg-void/70 p-3 shadow-[0_0_18px_rgba(255,59,107,0.25),inset_0_0_14px_rgba(255,59,107,0.12)]"
                    >
                      <p className="m-0 flex items-start gap-2 text-xs leading-snug text-ink">
                        <TriangleAlert size={16} className="mt-px shrink-0 text-neon-red" aria-hidden />
                        <span>
                          <b className="font-bold uppercase tracking-wider text-neon-red text-glow-red">Точно сбросить?</b> Это нельзя
                          отменить. Останется только стартовый подарок —{' '}
                          <span className="whitespace-nowrap text-neon-cyan">
                            {STARTING_CRYSTALS} {plural(STARTING_CRYSTALS, CRYSTAL_FORMS)}
                          </span>
                          .
                        </span>
                      </p>
                      <LossSummary save={save} />
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ActionButton ref={cancelRef} tone="ghost" sound={null} onClick={cancelReset}>
                          Отмена
                        </ActionButton>
                        <ActionButton tone="danger" icon={Trash2} sound={null} onClick={confirmReset}>
                          Да, сбросить
                        </ActionButton>
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
                    className="m-0 mt-3 flex items-start gap-2 text-[11px] font-semibold leading-snug tracking-wide text-neon-green"
                  >
                    <CircleCheck size={15} className="mt-px shrink-0" aria-hidden />
                    <span>
                      Прогресс сброшен. В кошельке стартовые {STARTING_CRYSTALS} {plural(STARTING_CRYSTALS, CRYSTAL_FORMS)}.
                    </span>
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
