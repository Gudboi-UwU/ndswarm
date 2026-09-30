import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Download a test or a whole project as a file. `path` is "/tests/1" or "/projects/1". */
export function ExportMenu({ path, note, size }: { path: string; note?: string; size?: 'default' | 'sm' }) {
  const link = (q: string) => `/api/v1${path}/export?${q}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={size}>
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {[
          ['format=ndswarm&type=json', 'ndswarm file (.json)'],
          ['format=ndswarm&type=yaml', 'ndswarm file (.yaml)'],
          ['format=postman', 'Postman collection'],
        ].map(([q, label]) => (
          <DropdownMenuItem key={q} asChild>
            <a href={link(q)} download>
              {label}
            </a>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Secret values are not exported. Postman files do not include load settings or pass/fail rules.{note ? ` ${note}` : ''}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
