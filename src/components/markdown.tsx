"use client";

import { isJson, isString, toAny } from "lib/utils";
import { LinkIcon } from "lucide-react";
import { PropsWithChildren, memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import JsonView from "ui/json-view";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { PreBlock } from "./pre-block";

const FadeIn = memo(({ children }: PropsWithChildren) => {
  return <span className="fade-in animate-in duration-1000">{children} </span>;
});
FadeIn.displayName = "FadeIn";

export const WordByWordFadeIn = memo(({ children }: PropsWithChildren) => {
  const childrens = [children]
    .flat()
    .flatMap((child) => (isString(child) ? child.split(" ") : child));
  return childrens.map((word, index) =>
    isString(word) ? <FadeIn key={index}>{word}</FadeIn> : word,
  );
});
WordByWordFadeIn.displayName = "WordByWordFadeIn";
const components: Partial<Components> = {
  table: ({ node, children, ...props }) => {
    return (
      <div className="my-4">
        <Table {...props}>{children}</Table>
      </div>
    );
  },
  thead: ({ node, children, ...props }) => {
    return <TableHeader {...props}>{children}</TableHeader>;
  },
  tbody: ({ node, children, ...props }) => {
    return <TableBody {...props}>{children}</TableBody>;
  },
  tr: ({ node, children, ...props }) => {
    return <TableRow {...props}>{children}</TableRow>;
  },
  th: ({ node, children, ...props }) => {
    return (
      <TableHead {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </TableHead>
    );
  },
  td: ({ node, children, ...props }) => {
    return (
      <TableCell {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </TableCell>
    );
  },
  code: ({ children }) => {
    return (
      <code className="text-sm rounded-md bg-accent text-primary py-1 px-2 mx-0.5">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => {
    return (
      <div className="px-4">
        <blockquote className="relative bg-accent/30 p-6 rounded-2xl my-6 overflow-hidden border">
          <WordByWordFadeIn>{children}</WordByWordFadeIn>
        </blockquote>
      </div>
    );
  },
  p: ({ children }) => {
    return (
      <p className="leading-6 my-4 break-words">
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </p>
    );
  },
  pre: ({ children }) => {
    return (
      <div className="px-4 py-2">
        <PreBlock>{children}</PreBlock>
      </div>
    );
  },
  ol: ({ node, children, ...props }) => {
    return (
      <ol className="px-8 list-decimal list-outside" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-2 break-words" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul className="px-8 list-outside list-disc" {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    return (
      <a
        className="text-primary hover:underline flex gap-1.5 items-center"
        target="_blank"
        rel="noreferrer"
        {...toAny(props)}
      >
        <LinkIcon className="size-3.5" />
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </a>
    );
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h6>
    );
  },
  img: ({ node, children, ...props }) => {
    const { src, alt, ...rest } = props;

    return src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="mx-auto rounded-lg" src={src} alt={alt} {...rest} />
    ) : null;
  },
};

// Compact components for inline/tight markdown rendering (e.g., subagent output)
const compactComponents: Partial<Components> = {
  ...components,
  p: ({ children }) => {
    return (
      <p className="leading-5 my-1 break-words">
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </p>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul className="pl-4 list-outside list-disc my-1" {...props}>
        {children}
      </ul>
    );
  },
  ol: ({ node, children, ...props }) => {
    return (
      <ol className="pl-4 list-decimal list-outside my-1" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-0.5 break-words" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </li>
    );
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-base font-semibold mt-2 mb-1" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-sm font-semibold mt-2 mb-1" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-sm font-semibold mt-1.5 mb-0.5" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-xs font-semibold mt-1.5 mb-0.5" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-xs font-semibold mt-1 mb-0.5" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-xs font-semibold mt-1 mb-0.5" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h6>
    );
  },
  blockquote: ({ children }) => {
    return (
      <blockquote className="relative bg-accent/30 p-2 rounded-md my-1 overflow-hidden border-l-2 border-accent">
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </blockquote>
    );
  },
  pre: ({ children }) => {
    return (
      <div className="py-1">
        <PreBlock>{children}</PreBlock>
      </div>
    );
  },
  table: ({ node, children, ...props }) => {
    return (
      <div className="my-2">
        <Table {...props}>{children}</Table>
      </div>
    );
  },
};

interface MarkdownProps {
  children: string;
  compact?: boolean;
}

const NonMemoizedMarkdown = ({ children, compact = false }: MarkdownProps) => {
  return (
    <article className="w-full h-full relative">
      {isJson(children) ? (
        <JsonView data={children} />
      ) : (
        <ReactMarkdown
          components={compact ? compactComponents : components}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {children}
        </ReactMarkdown>
      )}
    </article>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.compact === nextProps.compact,
);
