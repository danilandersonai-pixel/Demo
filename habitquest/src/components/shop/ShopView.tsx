import { AnimatePresence, motion } from 'framer-motion';
import { Coins, Gift, Lock, Pencil, Plus, Save, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { maxHp } from '../../game/constants';
import { POTION_HEAL } from '../../game/engine';
import { CUSTOM_REWARD_ICONS, REWARD_ICONS } from '../../game/icons';
import type { GameActions } from '../../hooks/useGame';
import type { GameState, Reward, RewardIconId } from '../../types';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FieldLabel, Segmented } from '../ui/Controls';
import { GoldCounter, Panel } from '../ui/Misc';
import { Modal } from '../ui/Modal';
import { originFrom } from '../quests/TaskCards';

type SortMode = 'default' | 'cheap' | 'expensive' | 'popular';

interface ShopViewProps {
  state: GameState;
  actions: GameActions;
}

type EditTarget = { reward: Reward | null } | null;

export function ShopView({ state, actions }: ShopViewProps) {
  const { hero } = state;
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [pendingDelete, setPendingDelete] = useState<Reward | null>(null);
  const [sort, setSort] = useState<SortMode>('default');
  const heroMaxHp = maxHp(hero);

  const rewards = useMemo(() => {
    const list = [...state.rewards];
    if (sort === 'cheap') list.sort((a, b) => a.cost - b.cost);
    if (sort === 'expensive') list.sort((a, b) => b.cost - a.cost);
    if (sort === 'popular') list.sort((a, b) => b.purchases - a.purchases);
    return list;
  }, [state.rewards, sort]);

  const affordable = state.rewards.filter((r) => r.cost <= hero.gold).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div className="absolute -top-24 right-10 h-60 w-60 rounded-full bg-amber-500/15 blur-3xl" />
        </div>
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/20 to-orange-500/20 text-amber-200 shadow-[0_0_18px_-4px_rgba(251,146,60,0.8)]">
              <Store size={20} />
            </span>
            <div>
              <h1 className="font-display text-lg font-bold text-white">Магазин наград</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-400">
                Придумайте, чем себя порадовать, и покупайте это за золото, заработанное квестами.
              </p>
              <p className="mt-1 font-mono text-[11px] tracking-wider text-amber-300/80">
                ДОСТУПНО: {affordable} / {state.rewards.length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <GoldCounter value={hero.gold} size="lg" />
            <Button variant="gold" icon={<Plus size={16} />} onClick={() => setEditTarget({ reward: null })}>
              Награда
            </Button>
          </div>
        </div>
        <div className="relative mt-4 max-w-xl">
          <Segmented
            ariaLabel="Сортировка"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'default', label: 'По порядку' },
              { value: 'cheap', label: 'Дешевле' },
              { value: 'expensive', label: 'Дороже' },
              { value: 'popular', label: 'Популярные' },
            ]}
          />
        </div>
      </Panel>

      <motion.ul layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <AnimatePresence>
          {rewards.map((reward, i) => (
            <RewardCard
              key={reward.id}
              reward={reward}
              gold={hero.gold}
              hpFull={hero.hp >= heroMaxHp}
              index={i}
              onBuy={(origin) => actions.buyReward(reward.id, origin)}
              onEdit={() => setEditTarget({ reward })}
              onDelete={() => setPendingDelete(reward)}
            />
          ))}
        </AnimatePresence>
        <motion.li layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <motion.button
            type="button"
            onClick={() => setEditTarget({ reward: null })}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.95 }}
            className="focus-ring flex h-full min-h-48 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-400/25 bg-amber-400/[0.02] text-amber-200/70 backdrop-blur-xl transition-colors duration-300 hover:border-amber-300/60 hover:bg-amber-400/[0.05] hover:text-amber-100"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full border border-amber-400/40 shadow-[0_0_16px_-4px_rgba(251,191,36,0.8)]">
              <Plus size={22} />
            </span>
            <span className="text-sm font-semibold">Придумать награду</span>
          </motion.button>
        </motion.li>
      </motion.ul>

      <RewardFormModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={(draft, id) => (id ? actions.updateReward(id, draft) : actions.createReward(draft))}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Убрать награду?"
        message={pendingDelete ? `«${pendingDelete.title}» исчезнет из магазина. Золото за прошлые покупки не вернётся.` : ''}
        confirmLabel="Убрать"
        onConfirm={() => {
          if (pendingDelete) actions.deleteReward(pendingDelete.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

interface RewardCardProps {
  reward: Reward;
  gold: number;
  hpFull: boolean;
  index: number;
  onBuy: (origin: { x: number; y: number }) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RewardCard({ reward, gold, hpFull, index, onBuy, onEdit, onDelete }: RewardCardProps) {
  const meta = REWARD_ICONS[reward.icon];
  const Icon = meta.icon;
  const canAfford = gold >= reward.cost;
  const isPotion = reward.kind === 'potion';
  const blockedByHp = isPotion && hpFull;
  const disabled = !canAfford || blockedByHp;
  const progress = Math.min(100, (gold / reward.cost) * 100);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92 }}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30, delay: Math.min(index * 0.04, 0.3) }}
      className={`glass group card-shine flex flex-col gap-3 rounded-2xl p-4 transition-colors duration-300 hover:border-white/[0.2] ${
        canAfford && !blockedByHp ? 'border-amber-400/20' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={`grid h-12 w-12 place-items-center rounded-xl border ${
            isPotion
              ? 'border-red-400/35 bg-gradient-to-br from-red-500/20 to-rose-600/20 text-red-200 shadow-[0_0_16px_-4px_rgba(239,68,68,0.8)]'
              : 'border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-orange-500/15 text-amber-200 shadow-[0_0_16px_-6px_rgba(251,146,60,0.8)]'
          }`}
        >
          <Icon size={22} />
        </div>
        <div className="flex gap-0.5 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
          <IconButton label="Редактировать награду" tone="cyber" onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
          {!isPotion && (
            <IconButton label="Удалить награду" tone="danger" onClick={onDelete}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-100">{reward.title}</p>
        {reward.notes && <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{reward.notes}</p>}
        {isPotion && <p className="mt-1 text-xs text-red-300/90">Восстанавливает {POTION_HEAL} HP</p>}
        <p className="mt-1.5 font-mono text-[10px] tracking-wider text-slate-500">КУПЛЕНО: {reward.purchases}</p>
      </div>
      {!canAfford && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full border border-amber-500/15 bg-amber-950/40">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 drop-shadow-[0_0_6px_rgba(251,146,60,0.5)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] tracking-wider text-amber-200/60">НЕ ХВАТАЕТ {reward.cost - gold} G</p>
        </div>
      )}
      <Button
        variant={disabled ? 'ghost' : 'gold'}
        disabled={disabled}
        onClick={(e) => onBuy(originFrom(e))}
        icon={disabled ? <Lock size={15} /> : <ShoppingCart size={15} />}
        className="w-full"
        aria-label={`Купить «${reward.title}» за ${reward.cost} золота`}
      >
        <span className="flex items-center gap-1.5">
          {blockedByHp ? 'HP полное' : 'Купить'}
          <span className="opacity-50">·</span>
          <Coins size={14} />
          <span className="font-mono tracking-wider">{reward.cost}</span>
        </span>
      </Button>
    </motion.li>
  );
}

interface RewardFormModalProps {
  target: EditTarget;
  onClose: () => void;
  onSubmit: (draft: { title: string; notes: string; cost: number; icon: RewardIconId }, id: string | null) => void;
}

function RewardFormModal({ target, onClose, onSubmit }: RewardFormModalProps) {
  const lastTarget = useRef<EditTarget>(target);
  if (target) lastTarget.current = target;
  const shown = target ?? lastTarget.current;
  const formId = useId();

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={shown?.reward ? 'Редактировать награду' : 'Новая награда'}
      icon={<Gift size={18} className="text-amber-300" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="gold" type="submit" form={formId} icon={<Save size={16} />}>
            {shown?.reward ? 'Сохранить' : 'Добавить в магазин'}
          </Button>
        </>
      }
    >
      {shown && <RewardForm key={shown.reward?.id ?? 'new'} formId={formId} reward={shown.reward} onClose={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

function RewardForm({
  reward,
  formId,
  onClose,
  onSubmit,
}: {
  reward: Reward | null;
  formId: string;
  onClose: () => void;
  onSubmit: RewardFormModalProps['onSubmit'];
}) {
  const [title, setTitle] = useState(reward?.title ?? '');
  const [notes, setNotes] = useState(reward?.notes ?? '');
  const [cost, setCost] = useState(String(reward?.cost ?? 30));
  const [icon, setIcon] = useState<RewardIconId>(reward?.icon ?? 'gift');
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const notesId = useId();
  const costId = useId();
  const isPotion = reward?.kind === 'potion';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    const value = Number(cost);
    if (!trimmed) {
      setError('Назовите награду.');
      return;
    }
    if (!Number.isInteger(value) || value < 1 || value > 100_000) {
      setError('Цена — целое число от 1 до 100 000.');
      return;
    }
    onSubmit({ title: trimmed.slice(0, 60), notes, cost: value, icon }, reward?.id ?? null);
    onClose();
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <FieldLabel htmlFor={titleId}>Название</FieldLabel>
        <input
          id={titleId}
          data-autofocus
          className="field"
          value={title}
          maxLength={60}
          placeholder="Например: посмотреть сериал"
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div>
        <FieldLabel htmlFor={notesId}>Описание</FieldLabel>
        <input id={notesId} className="field" value={notes} maxLength={120} placeholder="Необязательно" onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <FieldLabel htmlFor={costId}>Цена в золоте</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={costId}
            type="number"
            inputMode="numeric"
            min={1}
            max={100000}
            className="field w-32 font-mono tracking-wider"
            value={cost}
            onChange={(e) => {
              setCost(e.target.value);
              setError(null);
            }}
          />
          {[20, 50, 100, 250].map((preset) => (
            <motion.button
              key={preset}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => setCost(String(preset))}
              className="focus-ring cursor-pointer rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 font-mono text-xs font-bold tracking-wider text-amber-200 transition-colors duration-300 hover:bg-amber-400/20"
            >
              {preset}
            </motion.button>
          ))}
        </div>
      </div>
      {!isPotion && (
        <div>
          <FieldLabel>Иконка</FieldLabel>
          <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Иконка награды">
            {CUSTOM_REWARD_ICONS.map((id) => {
              const meta = REWARD_ICONS[id];
              const Icon = meta.icon;
              const active = id === icon;
              return (
                <motion.button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={meta.label}
                  title={meta.label}
                  onClick={() => setIcon(id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.92 }}
                  className={`focus-ring grid aspect-square cursor-pointer place-items-center rounded-xl border transition-[background-color,border-color,color,box-shadow] duration-300 ${
                    active
                      ? 'border-amber-300/60 bg-amber-400/15 text-amber-100 shadow-[0_0_16px_-4px_rgba(251,191,36,0.9)]'
                      : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/[0.18] hover:text-slate-100'
                  }`}
                >
                  <Icon size={20} />
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </form>
  );
}
