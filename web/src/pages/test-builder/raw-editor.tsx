import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import type { EnvVar, Generator } from '@/api/types'
import { useBuilder } from './draft'

/** Raw body text. Typing "{{" suggests generators and environment variables. */
export function RawEditor({ value, onChange, isJson, label }: { value: string; onChange: (v: string) => void; isJson: boolean; label: string }) {
  const { generators, variables, readOnly } = useBuilder()
  const { resolvedTheme } = useTheme()
  const extensions = useMemo(
    () => [
      ...(isJson ? [json()] : []),
      autocompletion({ override: [templateCompletions(generators, variables)] }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ],
    [isJson, generators, variables, label],
  )
  return (
    <div className="overflow-hidden rounded-md border text-[13px]">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={resolvedTheme === 'light' ? 'light' : 'dark'}
        editable={!readOnly}
        minHeight="160px"
        maxHeight="480px"
        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  )
}

function templateCompletions(generators: Generator[], variables: EnvVar[]) {
  const options = [
    ...variables.map((v) => ({ label: `var "${v.key}"`, detail: 'variable', apply: `var "${v.key}"` })),
    ...generators.map((g) => ({ label: g.id, detail: g.label, apply: g.snippet.slice(2, -2) })),
  ]
  return (ctx: CompletionContext) => {
    const before = ctx.matchBefore(/\{\{\s*[\w"]*$/)
    if (!before) return null
    const open = before.text.match(/^\{\{\s*/)![0].length // complete what follows "{{ "
    return { from: before.from + open, options, validFor: /^[\w"]*$/ }
  }
}
