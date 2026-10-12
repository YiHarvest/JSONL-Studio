import { Fragment } from "react";

const MAX_HIGHLIGHTS = 1000;

export function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const needle = query.trim();
  if (!needle) return text;

  const source = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  let count = 0;

  while (cursor < text.length && count < MAX_HIGHLIGHTS) {
    const index = source.indexOf(target, cursor);
    if (index < 0) break;
    if (index > cursor)
      parts.push({ text: text.slice(cursor, index), hit: false });
    parts.push({
      text: text.slice(index, index + needle.length),
      hit: true,
    });
    cursor = index + needle.length;
    count++;
  }

  if (!parts.length) return text;
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), hit: false });

  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark className="search-mark" key={index}>
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
