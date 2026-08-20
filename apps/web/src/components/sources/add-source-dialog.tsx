'use client';

import * as Tabs from '@radix-ui/react-tabs';
import { Link2, Loader2, Type, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ACCEPTED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '@everlast/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { useAddTextSource, useAddUrlSource, useUploadSource } from '@/hooks/use-sources';
import { ApiRequestError } from '@/lib/api-client';
import { cn, formatBytes } from '@/lib/utils';

const ACCEPT = Object.keys(ACCEPTED_UPLOAD_MIME_TYPES).join(',');

/** Maps API error codes onto the copy the user should see. */
const errorMessageKey = (error: unknown): string => {
  if (error instanceof ApiRequestError) {
    if (error.code === 'source.duplicate') return 'duplicate';
    if (error.code === 'source.limit_reached') return 'limitReached';
  }
  return '';
};

export function AddSourceDialog({
  notebookId,
  open,
  onOpenChange,
}: {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('sources');
  const tc = useTranslations('common');

  const upload = useUploadSource(notebookId);
  const addUrl = useAddUrlSource(notebookId);
  const addText = useAddTextSource(notebookId);

  const [url, setUrl] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setUrl('');
    setPasteTitle('');
    setPasteBody('');
    setError(null);
  };

  const handleError = (caught: unknown) => {
    const key = errorMessageKey(caught);
    const message = key ? t(key) : tc('errorBody');
    setError(message);
    toast.error(tc('error'), { description: message });
  };

  const succeed = () => {
    toast.success(t('added'), { description: t('processing') });
    onOpenChange(false);
    reset();
  };

  const uploadFiles = async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files);

    for (const file of list) {
      // Checked here as well as server-side so an oversized file fails
      // instantly instead of after a 50 MB round trip.
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name}: ${formatBytes(file.size)} > ${formatBytes(MAX_UPLOAD_BYTES)}`);
        return;
      }
      try {
        await upload.mutateAsync(file);
      } catch (caught) {
        handleError(caught);
        return;
      }
    }
    succeed();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
  };

  const submitUrl = async () => {
    setError(null);
    try {
      await addUrl.mutateAsync({ url: url.trim() });
      succeed();
    } catch (caught) {
      handleError(caught);
    }
  };

  const submitText = async () => {
    setError(null);
    try {
      await addText.mutateAsync({
        title: pasteTitle.trim(),
        content: pasteBody,
        kind: 'text',
      });
      succeed();
    } catch (caught) {
      handleError(caught);
    }
  };

  const busy = upload.isPending || addUrl.isPending || addText.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent title={t('addTitle')} size="lg">
        <Tabs.Root defaultValue="upload">
          <Tabs.List
            className="mx-6 flex gap-1 border-b border-border-default"
            aria-label={t('addTitle')}
          >
            {[
              { value: 'upload', label: t('tabUpload'), Icon: Upload },
              { value: 'link', label: t('tabLink'), Icon: Link2 },
              { value: 'paste', label: t('tabPaste'), Icon: Type },
            ].map(({ value, label, Icon }) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className={cn(
                  'inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2',
                  'text-[13px] font-medium text-foreground-muted transition-colors',
                  'hover:text-foreground',
                  'data-[state=active]:border-accent data-[state=active]:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="upload">
            <DialogBody>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'rounded-card border-2 border-dashed p-10 text-center transition-colors',
                  dragging
                    ? 'border-accent bg-accent-subtle/40'
                    : 'border-border-default hover:border-border-strong',
                )}
              >
                {upload.isPending ? (
                  <Loader2 className="mx-auto size-5 animate-spin text-foreground-muted" />
                ) : (
                  <Upload className="mx-auto size-5 text-foreground-subtle" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="mt-3 block w-full text-[13px] font-medium text-foreground"
                >
                  {t('dropzone')}
                </button>
                <p className="mt-1 text-[12px] text-foreground-subtle">{t('dropzoneHint')}</p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    if (event.target.files?.length) void uploadFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
              {error && (
                <p role="alert" className="mt-3 text-[13px] text-danger">
                  {error}
                </p>
              )}
            </DialogBody>
          </Tabs.Content>

          <Tabs.Content value="link">
            <DialogBody>
              <Input
                label={t('urlLabel')}
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('urlPlaceholder')}
                {...(error ? { error } : {})}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                loading={addUrl.isPending}
                disabled={!url.trim()}
                onClick={submitUrl}
              >
                {t('add')}
              </Button>
            </DialogFooter>
          </Tabs.Content>

          <Tabs.Content value="paste">
            <DialogBody className="space-y-4">
              <Input
                label={t('pasteTitleLabel')}
                value={pasteTitle}
                onChange={(event) => setPasteTitle(event.target.value)}
                placeholder={t('pasteTitlePlaceholder')}
                maxLength={300}
              />
              <Textarea
                label={t('pasteLabel')}
                value={pasteBody}
                onChange={(event) => setPasteBody(event.target.value)}
                placeholder={t('pastePlaceholder')}
                rows={10}
                {...(error ? { error } : {})}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {tc('cancel')}
              </Button>
              <Button
                variant="primary"
                loading={addText.isPending}
                disabled={!pasteTitle.trim() || !pasteBody.trim()}
                onClick={submitText}
              >
                {t('add')}
              </Button>
            </DialogFooter>
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}
