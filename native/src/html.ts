/**
 * Tagged template for markup spread over several lines.
 *
 * Line breaks in the static text are layout only. A break (with the indentation
 * around it) disappears at the start or end of the template and next to a tag
 * bracket; anywhere else, between words, attributes or interpolations, it becomes
 * one space. Interpolated values are inserted untouched, so escape them first.
 * Do not use it for content where newlines matter, such as <pre> or <textarea>.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((part, index) => {
    const first = index === 0;
    const last = index === strings.length - 1;
    out += part.replace(/\s*\n\s*/g, (gap: string, offset: number) => {
      const atStart = first && offset === 0;
      const atEnd = last && offset + gap.length === part.length;
      const nextToTag = part[offset - 1] === '>' || part[offset + gap.length] === '<';
      return atStart || atEnd || nextToTag ? '' : ' ';
    });
    if (index < values.length) out += String(values[index]);
  });
  return out;
}
