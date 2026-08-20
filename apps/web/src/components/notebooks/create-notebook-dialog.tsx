'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { useRouter } from '@/i18n/navigation';
import { useCreateNotebook } from '@/hooks/use-notebooks';

const EMOJI_CHOICES = ['📓', '🔬', '📊', '⚖️', '🧭', '🗂️', '💡', '🧪'];

export function CreateNotebookDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('notebooks');
  const tc = useTranslations('common');
  const router = useRouter();
  const create = useCreateNotebook();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]!);

  const reset = () => {
    setTitle('');
    setDescription('');
    setEmoji(EMOJI_CHOICES[0]!);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;

    try {
      const notebook = await create.mutateAsync({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        emoji,
      });

      toast.success(t('created'));
      onOpenChange(false);
      reset();
      // Straight into the new notebook — the next thing to do is add a source.
      router.push(`/notebooks/${notebook.id}`);
    } catch {
      toast.error(tc('error'), { description: tc('errorBody') });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent title={t('createTitle')} description={t('createSubtitle')}>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <div className="flex gap-3">
              <div className="space-y-1.5">
                <span className="block text-sm font-medium">&nbsp;</span>
                <div
                  role="radiogroup"
                  aria-label="Emoji"
                  className="flex h-9.5 items-center gap-0.5 rounded-lg border border-border-default bg-surface px-1"
                >
                  {EMOJI_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={emoji === choice}
                      onClick={() => setEmoji(choice)}
                      className={`grid size-7 place-items-center rounded-md text-sm transition-colors ${
                        emoji === choice ? 'bg-accent-subtle' : 'hover:bg-surface-hover'
                      }`}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Input
              label={t('createTitle')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('namePlaceholder')}
              maxLength={200}
              required
              autoFocus
            />

            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              maxLength={2000}
            />
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!title.trim()}
            >
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
