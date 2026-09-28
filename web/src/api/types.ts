// Mirrors internal/auth and internal/api. Go is the source of truth for validation.

export type Role = 'admin' | 'editor' | 'viewer'
export type GuestMode = 'off' | 'view' | 'run'

export interface User {
  id: number
  username: string
  role: Role
  createdAt: number
}

export interface Me {
  user: User | null
  guestMode: GuestMode
  setupRequired: boolean
  can: { view: boolean; run: boolean; edit: boolean; admin: boolean }
}

export interface Settings {
  guestMode: GuestMode
}

export interface SystemInfo {
  version: string
  goVersion: string
  cpus: number
  goroutines: number
  memMB: number
  uptimeSec: number
}

export interface FieldError {
  path: string
  message: string
}
