import { ArrowRight, BookOpen, Clock3, Factory, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { BAL, BUILDINGS, BUILD_ORDER, RESEARCH } from '../game/config';
import { GOALS } from '../game/goals';
import { duration, money, num, pct } from '../game/format';
import type { BuildingType, GameState, OfflineSummary } from '../game/types';
import { BUILDING_ICONS } from '../ui/icons';
import { Modal } from '../ui/primitives';
import { recipeOf } from './BuildMenu';

const CHAIN: BuildingType[] = ['miner', 'coder', 'trainer', 'publisher'];

function ChainDiagram() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-md border border-steel-700 bg-steel-950/70 p-3">
      {CHAIN.map((t, i) => {
        const def = BUILDINGS[t];
        const Icon = BUILDING_ICONS[t];
        return (
          <div key={t} className="flex items-center gap-1.5">
            <div className="flex flex-col items-center gap-1">
              <span
                className="grid h-10 w-10 place-items-center rounded-md border"
                style={{ borderColor: `${def.color}88`, background: `${def.color}14` }}
              >
                <Icon size={20} color={def.color} />
              </span>
              <span className="font-mono text-[9px] tracking-wider" style={{ color: def.color }}>
                {def.short}
              </span>
            </div>
            {i < CHAIN.length - 1 && (
              <span className="flex flex-col items-center font-mono text-[9px] text-steel-400">
                <ArrowRight size={14} />
                {i === 0 ? 'данные' : i === 1 ? 'код' : 'модели'}
              </span>
            )}
          </div>
        );
      })}
      <span className="flex flex-col items-center font-mono text-[9px] text-cash">
        <ArrowRight size={14} />$
      </span>
    </div>
  );
}

export function WelcomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      code="БРИФИНГ"
      title="Добро пожаловать в цех"
      icon={Factory}
      width="max-w-xl"
      footer={
        <button type="button" className="btn btn-primary w-full" onClick={onClose}>
          Запустить смену
        </button>
      }
    >
      <p className="text-[14px] leading-relaxed text-steel-200">
        Вы — главный инженер AI-Factory. Задача — построить фабрику ИИ-продуктов, которая зарабатывает сама, без
        единого клика. Стартовый капитал — {money(BAL.startCredits)}.
      </p>
      <div className="mt-3">
        <ChainDiagram />
      </div>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-snug text-steel-300">
        <li>
          Кликните по пустой ячейке и поставьте <span className="text-energy">Квантовый реактор</span> — без энергии
          цех не работает.
        </li>
        <li>
          Добавьте <span className="text-data">Генераторы данных</span> и <span className="text-code">Блоки вайбкодинга</span>.
          Излишки сразу уходят на биржу — это первые деньги.
        </li>
        <li>
          <span className="text-compute">GPU-кластер</span> + <span className="text-model">Кластер обучения LLM</span> делают
          модели, а <span className="text-cash">Терминал SaaS</span> продаёт их сам.
        </li>
        <li>
          Следите за нагрузкой сети: превысите генерацию — цех обесточится целиком. Ставьте поставщиков рядом с
          потребителями: прямой конвейер даёт +10% скорости.
        </li>
      </ol>
      <p className="mt-3 text-[12px] text-steel-500">
        Прогресс сохраняется в браузере автоматически, а пока вкладка закрыта, фабрика продолжает работать (до 4 часов).
      </p>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-steel-750 pt-3 first:border-0 first:pt-0">
      <h3 className="mb-1.5 font-display text-[12px] uppercase tracking-[0.14em] text-data">{title}</h3>
      <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-steel-300">{children}</div>
    </section>
  );
}

export function HelpDialog({ open, onClose, state }: { open: boolean; onClose: () => void; state: GameState }) {
  return (
    <Modal open={open} onClose={onClose} code="СПРАВКА" title="Справочник инженера" icon={BookOpen} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        <Section title="Рецепты цеха (Mk.I, с вашими исследованиями)">
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[480px] text-left text-[11.5px]">
              <thead className="text-steel-500">
                <tr>
                  <th className="py-1 pr-2 font-normal">Здание</th>
                  <th className="py-1 pr-2 font-normal">Вход → выход</th>
                  <th className="py-1 font-normal">Энергия</th>
                </tr>
              </thead>
              <tbody>
                {BUILD_ORDER.map((t) => {
                  const r = recipeOf(state, t);
                  return (
                    <tr key={t} className="border-t border-steel-800">
                      <td className="py-1 pr-2" style={{ color: BUILDINGS[t].color }}>
                        {BUILDINGS[t].name}
                      </td>
                      <td className="py-1 pr-2 text-steel-200">{r.io}</td>
                      <td className="py-1 text-steel-400">{r.energy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            Базовая пропорция: 1 кластер обучения ест код ~1,5 блоков вайбкодинга и данные ~2 генераторов, плюс половину
            GPU-кластера и половину терминала SaaS.
          </p>
        </Section>
        <Section title="Логистика и склад">
          <p>
            Все здания берут сырьё с общего склада каждый тик (1 тик = 1 секунда). Если ресурса не хватает, он делится
            между потребителями пропорционально спросу. Полный склад останавливает производителей — поможет сбыт,
            автопродажа или Хранилище (+100% вместимости за уровень).
          </p>
          <p>
            Автопродажа сбывает текущие излишки данных и кода на бирже по {money(BAL.price.data)} и{' '}
            {money(BAL.price.code)} за единицу (с учётом рыночного индекса), когда склад заполнен больше чем на{' '}
            {pct(BAL.autoSellReserve)}. Накопленные запасы она не сбрасывает — их можно продать вручную на вкладке «Рынок».
          </p>
          <p>
            Прямой конвейер: сосед-поставщик нужного ресурса даёт +{Math.round(BAL.adjBonus * 100)}% скорости, до +
            {Math.round(BAL.adjBonus * BAL.adjMax * 100)}%. Ленты на полу показывают такие связи.
          </p>
        </Section>
        <Section title="Энергосеть и вычисления">
          <p>
            Каждое включённое здание потребляет энергию. Если нагрузка больше генерации — обесточивается весь цех, и
            производство замирает. После «Умной энергосети» цех вместо этого замедляется пропорционально.
          </p>
          <p>
            GPU-кластеры дают PFLOPS для Кластеров обучения и AGI. Нехватка вычислений замедляет их пропорционально.
            Здания на паузе энергию не тратят.
          </p>
        </Section>
        <Section title="Технический долг">
          <p>
            Работающий Блок вайбкодинга набирает {num(BAL.debtRate * 60)} п. п. долга в минуту. При долге 100% его КПД
            падает до {pct(1 - BAL.debtLoss)}: данные съедаются, а кода выходит меньше. «Запустить ИИ-рефакторинг»
            мгновенно чистит все блоки за {money(BAL.refactorPerPoint)} за пункт долга (×уровень). «Код-ревью ботами»
            вдвое замедляет рост долга, а «{RESEARCH.cicd.name}» чистит блоки сам.
          </p>
        </Section>
        <Section title="Улучшения">
          <p>
            Каждый уровень (Mk.I → Mk.X) даёт +{Math.round(BAL.levelOut * 100)}% выпуска и +
            {Math.round(BAL.levelEnergy * 100)}% энергопотребления, а цена улучшения удваивается. Когда место на сетке
            кончается, улучшения — главный путь роста. Здание можно бесплатно перенести, а снос возвращает{' '}
            {pct(BAL.refund)} вложенного.
          </p>
        </Section>
        <Section title="Рынок, НИОКР и рекорды">
          <p>
            Цена модели колеблется вокруг {money(BAL.price.model)}: медленный индекс, хайп-волны и события вроде «ИИ-лихорадки».
            Суперкомпьютер AGI продаёт модели в {BAL.agiMult} раз дороже и забирает их со склада первым.
          </p>
          <p>
            Исследование оплачивается кредитами сразу, а чистый код лаборатория забирает по ходу работы наравне с
            Кластерами обучения. Одновременно идёт одно исследование.
          </p>
          <p>
            Рекорды «максимальный пассивный доход» и «узлов построено за всё время» хранятся в localStorage и переживают
            сброс фабрики. Контрактов: {GOALS.length}, каждый приносит награду.
          </p>
        </Section>
        <Section title="Управление">
          <ul className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            <li className="contents">
              <kbd className="text-data">Пробел · P</kbd>
              <span>пауза / продолжить</span>
            </li>
            <li className="contents">
              <kbd className="text-data">1 · 2 · 3</kbd>
              <span>скорость ×1, ×2, ×4</span>
            </li>
            <li className="contents">
              <kbd className="text-data">Esc</kbd>
              <span>закрыть окно или отменить перенос</span>
            </li>
          </ul>
        </Section>
      </div>
    </Modal>
  );
}

export function OfflineDialog({ summary, onClose }: { summary: OfflineSummary | null; onClose: () => void }) {
  return (
    <Modal
      open={summary !== null}
      onClose={onClose}
      code="ОТЧЁТ"
      title="Пока вас не было"
      icon={Clock3}
      color="#34d399"
      footer={
        <button type="button" className="btn btn-primary w-full" onClick={onClose}>
          Принять смену
        </button>
      }
    >
      {summary && (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-steel-200">
            Фабрика отработала без вас {duration(summary.seconds)}
            {summary.seconds >= BAL.offlineCap ? ' (максимум офлайн-режима)' : ''}.
          </p>
          <dl className="num grid grid-cols-2 gap-2">
            {[
              { l: 'Заработано', v: money(summary.earned), c: '#34d399' },
              { l: 'Обучено моделей', v: num(summary.models), c: '#f472b6' },
              { l: 'Написано кода', v: `${num(summary.code)} KLOC`, c: '#a855f7' },
              { l: 'Добыто данных', v: `${num(summary.data)} ТБ`, c: '#22d3ee' },
            ].map((x) => (
              <div key={x.l} className="rounded border border-steel-750 bg-steel-950/70 px-3 py-2">
                <dt className="font-mono text-[9.5px] uppercase tracking-wider text-steel-400">{x.l}</dt>
                <dd className="text-[16px] font-semibold" style={{ color: x.c }}>
                  {x.v}
                </dd>
              </div>
            ))}
          </dl>
          {summary.blackoutTicks > 0 && (
            <p className="text-[12.5px] text-alert">Цех простоял без питания {duration(summary.blackoutTicks)}.</p>
          )}
          {summary.research.length > 0 && (
            <p className="text-[12.5px] text-code">
              Завершены исследования: {summary.research.map((r) => RESEARCH[r].name).join(', ')}.
            </p>
          )}
          {summary.goals.length > 0 && (
            <p className="text-[12.5px] text-energy">Выполнено контрактов: {summary.goals.length}.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function ResetDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      code="СБРОС"
      title="Новая фабрика"
      icon={RotateCcw}
      color="#f43f5e"
      width="max-w-md"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Оставить как есть
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Снести и начать заново
          </button>
        </div>
      }
    >
      <p className="text-[14px] leading-relaxed text-steel-200">
        Все здания, ресурсы, кредиты и исследования будут удалены. Рекорды дохода и счётчик построенных узлов
        останутся — новая фабрика попробует их побить.
      </p>
    </Modal>
  );
}
