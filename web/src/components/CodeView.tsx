import CodeMirror from '@uiw/react-codemirror'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'

interface Props { value: string; onChange?: (value: string) => void; language?: 'json' | 'html' | 'xml' | 'text'; editable?: boolean; height?: string }

export default function CodeView({ value, onChange, language = 'text', editable = true, height = '240px' }: Props) {
  const extension = language === 'json' ? json() : language === 'html' ? html() : language === 'xml' ? xml() : []
  return <CodeMirror value={value} height={height} theme="dark" extensions={Array.isArray(extension) ? extension : [extension]} onChange={onChange} editable={editable} basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }} />
}