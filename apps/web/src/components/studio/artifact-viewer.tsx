'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { StudioContent } from '@everlast/contracts';

/**
 * Renders each studio kind. The exhaustive switch over the discriminated union
 * means adding a kind to the contract without adding a renderer here is a
 * compile error rather than a blank dialog in production.
 */
export function ArtifactViewer({
  content,
  audioUrl,
}: {
  content: StudioContent;
  audioUrl: string | null;
}) {
  const t = useTranslations('studio');

  switch (content.kind) {
    case 'study_guide':
      return (
        <div className="space-y-6">
          <Prose>{content.summary}</Prose>

          <Section title={t('keyConcepts')}>
            <dl className="space-y-3">
              {content.keyConcepts.map((concept) => (
                <div key={concept.term}>
                  <dt className="text-[13px] font-medium text-foreground">{concept.term}</dt>
                  <dd className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
                    {concept.definition}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title={t('shortAnswer')}>
            <ol className="space-y-3">
              {content.shortAnswerQuestions.map((entry, index) => (
                <li key={index}>
                  <p className="text-[13px] font-medium text-foreground">{entry.question}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
                    {entry.answer}
                  </p>
                </li>
              ))}
            </ol>
          </Section>

          {content.essayPrompts.length > 0 && (
            <Section title={t('essayPrompts')}>
              <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-foreground-muted marker:text-foreground-subtle">
                {content.essayPrompts.map((prompt, index) => (
                  <li key={index}>{prompt}</li>
                ))}
              </ul>
            </Section>
          )}

          {content.glossary.length > 0 && (
            <Section title={t('glossary')}>
              <dl className="space-y-2">
                {content.glossary.map((entry) => (
                  <div key={entry.term} className="text-[13px]">
                    <dt className="inline font-medium text-foreground">{entry.term}: </dt>
                    <dd className="inline text-foreground-muted">{entry.definition}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      );

    case 'briefing_doc':
      return (
        <div className="space-y-6">
          <Section title={t('executiveSummary')}>
            <Prose>{content.executiveSummary}</Prose>
          </Section>

          <Section title={t('themes')}>
            <div className="space-y-3">
              {content.themes.map((theme) => (
                <div key={theme.title}>
                  <p className="text-[13px] font-medium text-foreground">{theme.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
                    {theme.detail}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {content.notableQuotes.length > 0 && (
            <Section title={t('quotes')}>
              <div className="space-y-3">
                {content.notableQuotes.map((quote, index) => (
                  <blockquote
                    key={index}
                    className="border-l-2 border-accent pl-3 text-[13px] leading-relaxed"
                  >
                    <p className="text-foreground">“{quote.quote}”</p>
                    <footer className="mt-1 text-[12px] text-foreground-subtle">
                      — {quote.attribution}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </Section>
          )}

          {content.openQuestions.length > 0 && (
            <Section title={t('openQuestions')}>
              <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-foreground-muted marker:text-foreground-subtle">
                {content.openQuestions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      );

    case 'faq':
      return (
        <dl className="space-y-4">
          {content.entries.map((entry, index) => (
            <div key={index}>
              <dt className="text-[13px] font-medium text-foreground">{entry.question}</dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-foreground-muted">
                {entry.answer}
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'timeline':
      return (
        <div className="space-y-6">
          <Section title={t('events')}>
            <ol className="relative space-y-4 border-l border-border-default pl-5">
              {content.events.map((event, index) => (
                <li key={index} className="relative">
                  <span
                    className="absolute -left-[23px] top-1.5 size-2 rounded-full bg-accent ring-4 ring-surface"
                    aria-hidden
                  />
                  <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-foreground-subtle">
                    {event.when}
                  </p>
                  <p className="text-[13px] font-medium text-foreground">{event.label}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-foreground-muted">
                    {event.detail}
                  </p>
                </li>
              ))}
            </ol>
          </Section>

          {content.cast.length > 0 && (
            <Section title={t('cast')}>
              <dl className="space-y-2">
                {content.cast.map((member) => (
                  <div key={member.name} className="text-[13px]">
                    <dt className="inline font-medium text-foreground">{member.name}: </dt>
                    <dd className="inline text-foreground-muted">{member.role}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      );

    case 'audio_overview':
      return (
        <div className="space-y-5">
          {audioUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- the full
            // transcript is rendered directly below the player.
            <audio controls preload="metadata" src={audioUrl} className="w-full">
              <track kind="captions" />
            </audio>
          ) : (
            <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[12px] leading-relaxed text-foreground-muted">
              {t('audioUnavailable')}
            </p>
          )}

          <Section title={t('transcript')}>
            <div className="space-y-3">
              {content.turns.map((turn, index) => (
                <div key={index} className="flex gap-2.5">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
                      turn.speaker === 'host_a'
                        ? 'bg-accent-subtle text-accent-text'
                        : 'bg-surface-sunken text-foreground-muted'
                    }`}
                  >
                    {turn.speaker === 'host_a' ? t('hostA') : t('hostB')}
                  </span>
                  <p className="text-[13px] leading-relaxed text-foreground">{turn.text}</p>
                </div>
              ))}
            </div>
          </Section>
        </div>
      );
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{children}</p>
  );
}
