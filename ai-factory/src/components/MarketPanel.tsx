import { TrendingDown, TrendingUp } from 'lucide-react';
import { BAL, RES_META, SELLABLE } from '../game/config';
import { money, num, pct } from '../game/format';
import { exchangePrice, getMods } from '../game/selectors';
import type { GameState, SellableRes } from '../game/types';
import { RES_ICONS } from '../ui/icons';
import { Meter, Sparkline, Switch } from '../ui/primitives';

export function MarketPanel({
  state,
  onSell,
  onAutoSell,
}: {
  state: GameState;
  onSell: (res: SellableRes, fraction: number) => void;
  onAutoSell: (res: SellableRes, on: boolean) => void;
}) {
  const f = state.flow;
  const mods = getMods(state);
  const hist = state.market.history;
  const price = f.price;
  const past = hist.length > 30 ? hist[hist.length - 31] : hist[0] ?? price;
  const change = past > 0 ? price / past - 1 : 0;
  const base = BAL.price.model * mods.priceMult;
  const ev = state.market.event;
  const agiPrice = price * BAL.agiMult * mods.agiMult;
  const incomeTotal = Math.max(1e-9, f.incomeSaas + f.incomeAgi + f.incomeExchange);
  const Trend = change >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Цена модели">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-steel-400">Цена обученной модели</div>
            <div className="num text-2xl font-bold leading-tight text-model">{money(price)}</div>
          </div>
          <div className={`num flex items-center gap-1 text-[12px] ${change >= 0 ? 'text-cash' : 'text-alert'}`}>
            <Trend size={14} aria-hidden />
            {change >= 0 ? '+' : ''}
            {pct(change)} за 30 с
          </div>
        </div>
        <Sparkline values={hist} color="#f472b6" height={70} baseline={base} className="mt-2" />
        <div className="num mt-1 flex justify-between text-[10px] text-steel-500">
          <span>последние {hist.length} с</span>
          <span>пунктир — базовая цена {money(base)}</span>
        </div>
        {mods.agiUnlocked && (
          <p className="num mt-1 text-[11px] text-agi">AGI продаёт ту же модель за {money(agiPrice)} (×{BAL.agiMult * mods.agiMult}).</p>
        )}
      </section>

      {ev ? (
        <div
          className="rounded-md border px-3 py-2"
          style={{
            borderColor: ev.factor >= 1 ? '#34d39988' : '#f43f5e88',
            background: ev.factor >= 1 ? '#34d39912' : '#f43f5e12',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-[12px]" style={{ color: ev.factor >= 1 ? '#34d399' : '#f43f5e' }}>
              {ev.name}
            </span>
            <span className="num text-[11px] text-steel-300">ещё {Math.max(0, ev.endsAt - state.tick)} с</span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-steel-300">
            {ev.desc}. {ev.kind === 'grid' ? 'Генерация' : 'Цены'} ×{String(ev.factor).replace('.', ',')}.
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-steel-700 px-3 py-2 text-[11.5px] text-steel-400">
          Рынок спокоен. Следующее событие — примерно через {Math.max(0, state.market.nextEventAt - state.tick)} с.
        </p>
      )}

      <section aria-label="Биржа сырья" className="rounded-md border border-steel-700 bg-steel-950/60 p-3">
        <h3 className="font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">Биржа сырья</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-steel-400">
          Сырьё можно сбыть напрямую — дёшево, зато сразу. Автопродажа сбывает только текущие излишки выработки и
          не трогает резерв {pct(BAL.autoSellReserve)} вместимости; старые запасы продавайте вручную.
        </p>
        <div className="mt-2 flex flex-col gap-2.5">
          {SELLABLE.map((k) => {
            const meta = RES_META[k];
            const Icon = RES_ICONS[k];
            const p = exchangePrice(state, k);
            const stock = state.res[k];
            return (
              <div key={k}>
                <div className="flex items-center gap-2 text-[12px]">
                  <Icon size={13} color={meta.color} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-steel-200">{meta.name}</span>
                  <span className="num text-steel-300">
                    {num(stock)} {meta.unit} × {money(p)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button type="button" className="btn !min-h-7 !py-1" disabled={stock < 1} onClick={() => onSell(k, 0.5)}>
                    Продать 50%
                  </button>
                  <button type="button" className="btn btn-primary !min-h-7 !py-1" disabled={stock < 1} onClick={() => onSell(k, 1)}>
                    Всё · {money(stock * p)}
                  </button>
                  <span className="ml-auto">
                    <Switch
                      id={`market-autosell-${k}`}
                      checked={state.autoSell[k]}
                      onChange={(v) => onAutoSell(k, v)}
                      label="Авто"
                      color={meta.color}
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Структура дохода">
        <h3 className="mb-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">Выручка по источникам</h3>
        {[
          { label: 'Терминалы SaaS', v: f.incomeSaas, c: '#34d399' },
          { label: 'Суперкомпьютеры AGI', v: f.incomeAgi, c: '#f0abfc' },
          { label: 'Биржевой автомат', v: f.incomeExchange, c: '#22d3ee' },
        ].map((r) => (
          <div key={r.label} className="mb-1.5">
            <div className="num flex justify-between text-[11px]">
              <span className="text-steel-300">{r.label}</span>
              <span style={{ color: r.c }}>{money(r.v)}/с</span>
            </div>
            <Meter value={r.v / incomeTotal} color={r.c} height={4} className="mt-0.5" label={r.label} />
          </div>
        ))}
        <div className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] text-steel-400">
          <span>Продано моделей</span>
          <span className="text-right text-steel-200">{num(state.stats.modelsSold)}</span>
          <span>Ручные продажи</span>
          <span className="text-right text-steel-200">{money(state.stats.manualSales)}</span>
        </div>
      </section>
    </div>
  );
}
