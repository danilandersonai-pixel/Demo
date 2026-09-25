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
import { AnimatedNumber, Panel } from '../ui/Misc';
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
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-xl text-white">
              <Store size={22} className="text-amber-300" /> Магазин наград
            </h1>
            <p className="mt-1 max-w-xl text-sm text-violet-200/60">
              Придумайте, чем себя порадовать, и покупайте это за золото, заработанное квестами. Доступно сейчас: {affordable} из {state.rewards.length}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-2.5">
              <Coins size={22} className="text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
              <AnimatedNumber value={hero.gold} className="font-display text-2xl text-amber-200 neon-gold" />
            </div>
            <Button variant="gold" icon={<Plus size={16} />} onClick={() => setEditTarget({ reward: null })}>
              Награда
            </Button>
          </div>
        </div>
        <div className="mt-4 max-w-xl">
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
        <AnimatePresence initial={false}>
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
        <motion.li layout>
          <motion.button
            type="button"
            onClick={() => setEditTarget({ reward: null })}
            whileHover={{ y: -4, scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            className="focus-ring flex h-full min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-400/30 bg-amber-500/[0.03] text-amber-200/70 transition-colors hover:border-amber-300/60 hover:text-amber-100"
          >
            <Plus size={28} />
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
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30, delay: Math.min(index * 0.03, 0.3) }}
      whileHover={{ y: -4 }}
      className={`glass group relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4 ${
        canAfford ? 'border-amber-400/30' : ''
      }`}
    >
      {canAfford && !blockedByHp && (
        <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-amber-400/15 blur-2xl" />
      )}
      <div className="relative flex items-start justify-between gap-2">
        <div
          className={`grid h-12 w-12 place-items-center rounded-xl border ${
            isPotion ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-amber-400/35 bg-amber-500/10 text-amber-200'
          }`}
        >
          <Icon size={24} />
        </div>
        <div className="flex gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
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
      <div className="relative min-w-0 flex-1">
        <p className="font-semibold text-violet-50">{reward.title}</p>
        {reward.notes && <p className="mt-0.5 line-clamp-2 text-xs text-violet-200/55">{reward.notes}</p>}
        {isPotion && <p className="mt-1 text-xs text-rose-300/80">Восстанавливает {POTION_HEAL} HP</p>}
        <p className="mt-1.5 text-[11px] text-violet-200/40">Куплено: {reward.purchases}</p>
      </div>
      {!canAfford && (
        <div className="relative">
          <div className="h-1 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-amber-200/60">Не хватает {reward.cost - gold} золота</p>
        </div>
      )}
      <Button
        variant={disabled ? 'ghost' : 'gold'}
        disabled={disabled}
        onClick={(e) => onBuy(originFrom(e))}
        icon={disabled ? <Lock size={15} /> : <ShoppingCart size={15} />}
        className="relative w-full"
        aria-label={`Купить «${reward.title}» за ${reward.cost} золота`}
      >
        <span className="flex items-center gap-1">
          {blockedByHp ? 'HP полное' : 'Купить'} · <Coins size={14} /> {reward.cost}
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

function RewardForm({ reward, formId, onClose, onSubmit }: { reward: Reward | null; formId: string; onClose: () => void; onSubmit: RewardFormModalProps['onSubmit'] }) {
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
            className="field w-32"
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
              whileTap={{ scale: 0.9 }}
              onClick={() => setCost(String(preset))}
              className="focus-ring cursor-pointer rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
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
                  whileTap={{ scale: 0.88 }}
                  className={`focus-ring grid aspect-square cursor-pointer place-items-center rounded-xl border transition-all ${
                    active
                      ? 'border-amber-300/70 bg-amber-500/20 text-amber-100 shadow-[0_0_16px_-4px_rgba(251,191,36,0.9)]'
                      : 'border-violet-400/15 bg-white/[0.03] text-violet-200/55 hover:text-violet-100'
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
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
    </form>
  );
}
