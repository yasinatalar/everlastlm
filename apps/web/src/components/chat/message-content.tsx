'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@everlast/contracts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const MARKER = /\[(\d+)\]/g;

/**
 * Renders an answer with its inline citation markers turned into interactive
 * chips.
 *
 * The markers are split out *before* markdown parsing rather than handled by a
 * custom renderer, because a marker can land inside emphasis or a list item and
 * a post-parse walk would have to reimplement that traversal. Splitting first
 * keeps each fragment valid markdown on its own.
 */
export function MessageContent({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations: Citation[];
  onCitationClick?: (citation: Citation) => void;
}) {
  const byMarker = useMemo(
    () => new Map(citations.map((citation) => [citation.marker, citation])),
    [citations],
  );

  const segments = useMemo(() => {
    const result: ({ type: 'text'; value: string } | { type: 'cite'; marker: number })[] = [];
    let lastIndex = 0;

    for (const match of content.matchAll(MARKER)) {
      const marker = Number(match[1]);
      // A bracketed number that is not a known citation is ordinary text —
      // sources are full of "[3]" as a footnote of their own.
      if (!byMarker.has(marker)) continue;

      if (match.index > lastIndex) {
        result.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      result.push({ type: 'cite', marker });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      result.push({ type: 'text', value: content.slice(lastIndex) });
    }
    return result;
  }, [content, byMarker]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="text-[14px] leading-[1.65] text-foreground">
        {segments.map((segment, index) =>
          segment.type === 'text' ? (
            <Markdown key={index} value={segment.value} />
          ) : (
            <CitationChip
              key={index}
              citation={byMarker.get(segment.marker)!}
              {...(onCitationClick ? { onClick: onCitationClick } : {})}
            />
          ),
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * `display: contents` on the wrapper lets a fragment that is only part of a
 * paragraph flow inline with the citation chips around it.
 */
function Markdown({ value }: { value: string }) {
  return (
    <div className="contents [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className="block whitespace-pre-wrap">{children}</span>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-foreground-subtle">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-foreground-subtle">
              {children}
            </ol>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[12.5px]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-surface-sunken p-3 text-[12.5px]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-accent pl-3 text-foreground-muted">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1 mt-3 font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1 mt-3 font-medium">{children}</h4>,
          // Model output should not contain links, but if it does, treat it as
          // untrusted: no referrer, no opener, and never followed.
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="text-accent-text underline underline-offset-2"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border-default bg-surface-sunken px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border-default px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function CitationChip({
  citation,
  onClick,
}: {
  citation: Citation;
  onClick?: (citation: Citation) => void;
}) {
  const t = useTranslations('chat');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onClick?.(citation)}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent-subtle px-1 align-[1px] text-[10px] font-semibold tabular-nums text-accent-text transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {citation.marker}
        </button>
      </TooltipTrigger>

      <TooltipContent className="max-w-sm">
        <p className="text-[11px] font-medium text-foreground">
          {t('citationFrom', { source: citation.sourceTitle })}
          {citation.pageNumber ? ` · ${t('citationPage', { page: citation.pageNumber })}` : ''}
        </p>
        <p className="mt-1 line-clamp-4 text-[12px] leading-relaxed text-foreground-muted">
          “{citation.quotedText}”
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
