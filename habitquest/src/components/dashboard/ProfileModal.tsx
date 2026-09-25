import { motion } from 'framer-motion';
import { Save, UserRound } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { AVATARS, AVATAR_ORDER } from '../../game/icons';
import type { AvatarId, Hero } from '../../types';
import { Button } from '../ui/Button';
import { FieldLabel } from '../ui/Controls';
import { Modal } from '../ui/Modal';

interface ProfileModalProps {
  open: boolean;
  hero: Hero;
  onClose: () => void;
  onSave: (name: string, avatar: AvatarId) => void;
}

export function ProfileModal({ open, hero, onClose, onSave }: ProfileModalProps) {
  const formId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Профиль героя"
      icon={<UserRound size={18} className="text-cyan-300" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" form={formId} icon={<Save size={16} />}>
            Сохранить
          </Button>
        </>
      }
    >
      {open && <ProfileForm key={`${hero.name}-${hero.avatar}`} formId={formId} hero={hero} onSave={onSave} onClose={onClose} />}
    </Modal>
  );
}

function ProfileForm({ hero, onSave, onClose, formId }: Omit<ProfileModalProps, 'open'> & { formId: string }) {
  const [name, setName] = useState(hero.name);
  const [avatar, setAvatar] = useState<AvatarId>(hero.avatar);
  const nameId = useId();
  const submitted = useRef(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true;
    onSave(name, avatar);
    onClose();
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-5">
      <div>
        <FieldLabel htmlFor={nameId}>Имя героя</FieldLabel>
        <input id={nameId} data-autofocus className="field" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Как вас зовут, странник?" />
      </div>
      <div>
        <FieldLabel>Класс и аватар</FieldLabel>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Аватар">
          {AVATAR_ORDER.map((id) => {
            const meta = AVATARS[id];
            const Icon = meta.icon;
            const active = id === avatar;
            return (
              <motion.button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAvatar(id)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.92 }}
                className={`focus-ring flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-2 text-[11px] font-semibold transition-all ${
                  active ? 'border-cyan-300/60 bg-cyan-500/10 text-white shadow-[0_0_18px_-4px_rgba(34,211,238,0.9)]' : 'border-violet-400/15 bg-white/[0.03] text-violet-200/60'
                }`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br p-[2px] ${meta.gradient}`}>
                  <span className="grid h-full w-full place-items-center rounded-[10px] bg-[#0b0820]">
                    <Icon size={20} className="text-white" />
                  </span>
                </span>
                {meta.label}
              </motion.button>
            );
          })}
        </div>
      </div>
    </form>
  );
}
