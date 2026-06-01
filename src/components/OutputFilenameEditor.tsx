'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

export const OUTPUT_FILENAME_EXTENSION = '.%(ext)s';

export const stripOutputFilenameExtension = (value: string) =>
  value.endsWith(OUTPUT_FILENAME_EXTENSION)
    ? value.slice(0, -OUTPUT_FILENAME_EXTENSION.length)
    : value;

export const appendOutputFilenameExtension = (value: string) =>
  value.endsWith(OUTPUT_FILENAME_EXTENSION) ? value : `${value}${OUTPUT_FILENAME_EXTENSION}`;

const OUTPUT_FILENAME_TOKENS = [
  { value: '%(title)s', label: 'Title', description: 'Video title' },
  { value: '%(id)s', label: 'ID', description: 'Video ID' },
  { value: '%(uploader)s', label: 'Uploader', description: 'Uploader name' },
  { value: '%(channel)s', label: 'Channel', description: 'Channel name' },
  { value: '%(upload_date)s', label: 'Upload Date', description: 'YYYYMMDD' },
  { value: '%(playlist_index)s', label: 'Playlist Index', description: 'Playlist order' },
  { value: '%(playlist_title)s', label: 'Playlist Title', description: 'Playlist name' },
  { value: '%(duration)s', label: 'Duration', description: 'Seconds' }
] as const;

const OUTPUT_FILENAME_TOKEN_MAP = new Map(
  OUTPUT_FILENAME_TOKENS.map((token) => [token.value, token])
);
const outputFilenameTokenRegex = new RegExp(
  `(${OUTPUT_FILENAME_TOKENS.map((token) =>
    token.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|')})`,
  'g'
);

type OutputFilenameToken = (typeof OUTPUT_FILENAME_TOKENS)[number];
type OutputFilenamePart =
  | { type: 'text'; value: string }
  | { type: 'token'; value: OutputFilenameToken['value'] };
type OutputFilenameEditorHandle = {
  insertToken: (tokenValue: OutputFilenameToken['value']) => void;
};

const parseOutputFilename = (value: string): OutputFilenamePart[] => {
  const parts: OutputFilenamePart[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(outputFilenameTokenRegex)) {
    const index = match.index ?? 0;
    parts.push({ type: 'text', value: value.slice(lastIndex, index) });
    parts.push({ type: 'token', value: match[0] as OutputFilenameToken['value'] });
    lastIndex = index + match[0].length;
  }

  parts.push({ type: 'text', value: value.slice(lastIndex) });
  return parts;
};

const getNodeValue = (node: Node) => {
  if (node instanceof HTMLElement && node.dataset.filenameToken) {
    return node.dataset.filenameToken;
  }
  return node.textContent || '';
};

const getEditorValue = (editor: HTMLDivElement) =>
  Array.from(editor.childNodes)
    .map(getNodeValue)
    .join('');

const getOffsetWithinEditor = (editor: HTMLDivElement, node: Node, offset: number) => {
  let topLevelNode = node;
  while (topLevelNode.parentNode && topLevelNode.parentNode !== editor) {
    topLevelNode = topLevelNode.parentNode;
  }

  if (node === editor) {
    return Array.from(editor.childNodes)
      .slice(0, offset)
      .reduce((length, child) => length + getNodeValue(child).length, 0);
  }

  const precedingLength = Array.from(editor.childNodes)
    .slice(0, Array.from(editor.childNodes).findIndex((child) => child === topLevelNode))
    .reduce((length, child) => length + getNodeValue(child).length, 0);

  return precedingLength + (node.nodeType === Node.TEXT_NODE ? offset : 0);
};

const setCaretPosition = (editor: HTMLDivElement, position: number) => {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let consumedLength = 0;

  for (const child of Array.from(editor.childNodes)) {
    const childValue = getNodeValue(child);
    const nextLength = consumedLength + childValue.length;

    if (child.nodeType === Node.TEXT_NODE && position <= nextLength) {
      range.setStart(child, Math.max(position - consumedLength, 0));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    if (child instanceof HTMLElement && position <= nextLength) {
      const childIndex = Array.from(editor.childNodes).indexOf(child);
      range.setStart(editor, position === consumedLength ? childIndex : childIndex + 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    consumedLength = nextLength;
  }

  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const renderEditorValue = (editor: HTMLDivElement, value: string) => {
  editor.replaceChildren();

  for (const part of parseOutputFilename(value)) {
    if (part.type === 'text') {
      if (part.value) editor.append(document.createTextNode(part.value));
      continue;
    }

    const token = OUTPUT_FILENAME_TOKEN_MAP.get(part.value);
    const chip = document.createElement('span');
    chip.contentEditable = 'false';
    chip.dataset.filenameToken = part.value;
    chip.className =
      'mx-px inline-flex h-6 select-none items-center rounded-md border border-primary/20 bg-primary/10 px-2.5 align-middle text-sm font-medium leading-none text-primary';
    chip.title = part.value;
    chip.textContent = token?.label || part.value;
    editor.append(chip);
  }
};

const OutputFilenameEditor = forwardRef<
  OutputFilenameEditorHandle,
  {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }
>(function OutputFilenameEditor({ value, disabled = false, onChange }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });

  const updateSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.anchorNode || !selection.focusNode) return;
    if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;

    const anchor = getOffsetWithinEditor(editor, selection.anchorNode, selection.anchorOffset);
    const focus = getOffsetWithinEditor(editor, selection.focusNode, selection.focusOffset);
    selectionRef.current = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  };

  const syncEditorValue = (nextValue: string, caretPosition?: number) => {
    const editor = editorRef.current;
    if (!editor) return;

    renderEditorValue(editor, nextValue);
    if (caretPosition === undefined) return;

    editor.focus();
    setCaretPosition(editor, caretPosition);
    selectionRef.current = { start: caretPosition, end: caretPosition };
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && getEditorValue(editor) !== value) {
      syncEditorValue(value);
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertToken(tokenValue) {
      const { start, end } = selectionRef.current;
      const nextValue = `${value.slice(0, start)}${tokenValue}${value.slice(end)}`;
      const nextCaretPosition = start + tokenValue.length;
      syncEditorValue(nextValue, nextCaretPosition);
      onChange(nextValue);
    }
  }));

  return (
    <div
      ref={editorRef}
      role='textbox'
      aria-label='Output filename'
      aria-disabled={disabled}
      contentEditable={!disabled}
      suppressContentEditableWarning
      className='min-h-[34px] min-w-0 flex-1 cursor-text rounded-md border border-input bg-background px-1.5 py-1 text-left text-sm leading-6 focus-within:ring-1 focus-within:ring-ring empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]'
      data-placeholder='Tap + to add filename variables'
      onInput={(event) => {
        updateSelection();
        onChange(getEditorValue(event.currentTarget));
      }}
      onFocus={updateSelection}
      onBlur={() => {
        updateSelection();
        const editor = editorRef.current;
        if (editor) renderEditorValue(editor, getEditorValue(editor));
      }}
      onClick={updateSelection}
      onKeyUp={updateSelection}
      onPointerUp={updateSelection}
    />
  );
});

export function OutputFilenameEditorField({
  value,
  disabled = false,
  onChange,
  className = ''
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  const editorRef = useRef<OutputFilenameEditorHandle>(null);

  return (
    <div className={`flex min-w-0 basis-[320px] flex-1 items-start gap-x-1 ${className}`}>
      <OutputFilenameEditor ref={editorRef} value={value} disabled={disabled} onChange={onChange} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            className='h-[34px] w-[34px] shrink-0 rounded-full border border-primary/30 bg-primary/90 px-0 py-0 text-primary-foreground shadow-sm hover:bg-primary'
            disabled={disabled}
            title='Add filename variable'
          >
            <Plus className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuLabel>Filename variables</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OUTPUT_FILENAME_TOKENS.map((token) => (
            <DropdownMenuItem
              key={token.value}
              className='cursor-pointer items-start gap-x-2'
              onClick={() => editorRef.current?.insertToken(token.value)}
            >
              <span className='min-w-[112px] text-sm'>{token.label}</span>
              <span className='flex flex-col text-xs text-muted-foreground'>
                <span>{token.value}</span>
                {token.description ? <span>{token.description}</span> : null}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
            Extension is automatically appended as .%(ext)s.
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
