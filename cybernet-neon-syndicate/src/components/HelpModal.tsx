import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { BANKRUPTCY_DAYS, BUILDINGS, BUILDING_ORDER, EVENT_INTERVAL, MAX_LEVEL, WEALTH_FREE, WEALTH_RATE } from '../game/config.ts';
import { fmt } from '../game/format.ts';
import { useGameContext } from './GameContext.tsx';
import { HallOfFame } from './HallOfFame.tsx';
import { ACCENT } from './ui/accent.ts';
import { cn } from './ui/cn.ts';
import { BUILDING_ICONS } from './ui/icons.ts';
import { Modal } from './ui/Modal.tsx';
import { NeonButton } from './ui/NeonButton.tsx';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="font-mono text-[11px] font-semibold tracking-[0.25em] text-data">{title}</h3>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** Справка: правила, таблица построек, горячие клавиши и настройки. Пока открыта — игра на паузе. */
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useGameContext();
  const [wipeArmed, setWipeArmed] = useState(false);

  useEffect(() => {
    if (!open) setWipeArmed(false);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="help-title" className="max-w-3xl" layer="z-[80]">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-7 scroll-thin">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-dim">МАНУАЛ ОПЕРАТОРА · ИГРА НА ПАУЗЕ</div>
            <h2 id="help-title" className="font-display text-xl font-bold uppercase tracking-wide text-ink">
              Как играть
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть справку"
            className="grid size-8 shrink-0 place-items-center border border-line text-muted hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <Section title="ЦЕЛЬ">
          <p>
            Вы управляете подпольным синдикатом. 1 секунда — 1 игровой день. Держите экономику в плюсе как можно дольше: если кредиты уйдут в минус и
            продержатся так {BANKRUPTCY_DAYS} дней подряд, наступит банкротство. Рекорды дней и капитала сохраняются в браузере.
          </p>
        </Section>

        <Section title="РЕСУРСЫ">
          <p>
            <span className="text-credit">Кредиты</span> — валюта для построек, улучшений и исследований. Каждый день списывается содержание зданий и
            накладные расходы, а инфляция медленно их увеличивает. Кредиты сверх {fmt(WEALTH_FREE)}₵ ежедневно теряют {WEALTH_RATE * 100}% на «отмывание» —
            бесконечно копить невыгодно, деньги должны работать.
          </p>
          <p>
            <span className="text-data">Данные</span> нужны для исследований и дорогих построек. Хранилище ограничено: излишек теряется. Данные можно продать
            на дата-бирже по плавающему курсу или купить с наценкой.
          </p>
          <p>
            <span className="text-energy">Энергия</span> копится в хранилище. Потребителя нельзя построить без свободной мощности. Если во время события запас
            упадёт до нуля — блэкаут: производство стоит, а содержание списывается, пока сеть не перезапустится. Излишек при полном хранилище продаётся в
            городскую сеть.
          </p>
        </Section>

        <Section title="ПОСТРОЙКИ">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] font-mono text-[11px]">
              <thead>
                <tr className="text-left text-dim">
                  <th className="py-1 pr-3 font-normal">ОБЪЕКТ</th>
                  <th className="py-1 pr-3 text-right font-normal">ЦЕНА</th>
                  <th className="py-1 pr-3 text-right font-normal">ДАЁТ</th>
                  <th className="py-1 pr-3 text-right font-normal">⚡</th>
                  <th className="py-1 text-right font-normal">СОДЕРЖ.</th>
                </tr>
              </thead>
              <tbody>
                {BUILDING_ORDER.map((id) => {
                  const def = BUILDINGS[id];
                  const Icon = BUILDING_ICONS[id];
                  const gives = [
                    def.energyProd ? `+${def.energyProd}⚡` : '',
                    def.creditProd ? `+${def.creditProd}₵` : '',
                    def.dataProd ? `+${def.dataProd} DB` : '',
                    def.aura ? '+15% соседям (до +100%)' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr key={id} className="border-t border-line">
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-2 text-ink">
                          <Icon className={cn('size-3.5', ACCENT[def.accent].text)} /> {def.name}
                        </span>
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right text-credit">
                        {fmt(def.baseCost.credits)}₵{def.baseCost.data ? ` +${def.baseCost.data}DB` : ''}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">{gives}</td>
                      <td className="tabular py-1.5 pr-3 text-right text-muted">{def.energyUse ? `−${def.energyUse}` : '—'}</td>
                      <td className="tabular py-1.5 text-right text-danger">{def.upkeep}₵</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            Цена растёт с каждой копией здания. Улучшение до {MAX_LEVEL} уровня повышает выработку сильнее, чем потребление, и экономит место в сетке. ИИ-Оптимизатор
            усиливает все 8 соседних ячеек, бонусы складываются до +100% на ячейку — планируйте раскладку. Ненужное здание можно перевести в режим ожидания (половина содержания) или
            демонтировать с возвратом 50% вложений.
          </p>
        </Section>

        <Section title="ИССЛЕДОВАНИЯ И СОБЫТИЯ">
          <p>
            Научный отдел ведёт одно исследование за раз. Технологии открываются по дереву: верхний ряд доступен сразу, нижние требуют предыдущих.
          </p>
          <p>
            Каждые {EVENT_INTERVAL} дней случается глобальное событие. Одни действуют сразу (вспышки, бури, обвалы рынка), в других нужно выбрать ответ за 10 дней —
            иначе сработает вариант по умолчанию. Если игра ускорена, на время решения скорость сбрасывается до 1×. Со временем угроза растёт. Авто-Брокер
            (исследование) не только продаёт излишки данных, но и гасит минус на счёте.
          </p>
        </Section>

        <Section title="УПРАВЛЕНИЕ">
          <div className="grid gap-1.5 font-mono text-[12px] sm:grid-cols-2">
            <span>
              <kbd className="border border-line px-1.5 text-ink">Пробел</kbd> пауза / продолжить
            </span>
            <span>
              <kbd className="border border-line px-1.5 text-ink">1</kbd> <kbd className="border border-line px-1.5 text-ink">2</kbd>{' '}
              <kbd className="border border-line px-1.5 text-ink">3</kbd> скорость 1× / 2× / 4×
            </span>
            <span>
              <kbd className="border border-line px-1.5 text-ink">H</kbd> эта справка
            </span>
            <span>
              <kbd className="border border-line px-1.5 text-ink">Esc</kbd> закрыть окно
            </span>
          </div>
        </Section>

        <Section title="НАСТРОЙКИ">
          <label className="flex cursor-pointer items-center justify-between gap-3 border border-line px-3 py-2">
            <span>
              <span className="text-ink">Автопауза</span> — игра останавливается, когда вкладка скрыта
            </span>
            <input
              id="setting-autopause"
              type="checkbox"
              checked={state.settings.autoPause}
              onChange={(event) => dispatch({ type: 'SET_AUTOPAUSE', value: event.target.checked })}
              className="size-4 accent-[var(--color-data)]"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 border border-line px-3 py-2">
            <span>Стереть Зал славы и рекорды</span>
            <NeonButton
              size="xs"
              accent="danger"
              variant={wipeArmed ? 'solid' : 'outline'}
              onClick={() => {
                if (wipeArmed) {
                  dispatch({ type: 'WIPE_RECORDS', now: Date.now() });
                  setWipeArmed(false);
                } else {
                  setWipeArmed(true);
                }
              }}
            >
              {wipeArmed ? 'Точно стереть?' : 'Стереть'}
            </NeonButton>
          </div>
        </Section>

        <Section title="ЗАЛ СЛАВЫ">
          <HallOfFame highlight={state.runId} />
        </Section>
      </div>
    </Modal>
  );
}
