// USB storage via luci.aw1000-storage (aw1000-storage in the hikariwrt feed).
// fstab + block stay the engine; format and extroot run as background jobs
// polled with job(). The backend refuses anything touching the disk that
// holds the running /overlay.

import { call } from './ubus'

export type PartMode = 'data' | 'rootfs-active' | 'rootfs-pending' | 'none' | string

export interface Partition {
  name: string
  dev: string
  size: number
  fs: string | null
  label: string | null
  uuid: string | null
  supported: boolean
  mounted: boolean
  mountpoint: string | null
  total_kb: number | null
  used_kb: number | null
  free_kb: number | null
  mode: PartMode
  fstab: string | null
  /** where fstab mounts it, mounted or not */
  target?: string | null
  enabled: boolean
  options: string | null
}

export interface Disk {
  name: string
  dev: string
  size: number
  vendor: string
  model: string
  serial: string
  usb_version: string
  speed_mbps: number
  removable: boolean
  readonly: boolean
  busy_job: boolean
  partitions: Partition[]
}

export interface Job {
  state: 'running' | 'done' | 'failed'
  kind: string
  target: string
  step: string
  message: string
  error: string
  started: number | null
  finished: number | null
}

export interface StorageStatus {
  ok: boolean
  internal: { location: string; dev: string; fs: string; total_kb: number; used_kb: number; free_kb: number; flash_dev: string; flash_total_kb: number; flash_used_kb: number }
  tmp: { total_kb: number; used_kb: number; free_kb: number }
  settings: { automount: boolean; check_fs: boolean; mount_root: string }
  job: Job | null
  disks: Disk[]
}

type Reply = { ok: boolean; error?: string; warning?: string }

export const status = () => call<StorageStatus>('luci.aw1000-storage', 'status')
export const job = () => call<{ ok: boolean; job: Job | null }>('luci.aw1000-storage', 'job')
export const mount = (part: string) => call<Reply>('luci.aw1000-storage', 'mount', { part })
/** Also stops automounting it. A busy drive is refused, naming who holds it. */
export const umount = (part: string) => call<Reply>('luci.aw1000-storage', 'umount', { part })
export const forget = (part: string) => call<Reply>('luci.aw1000-storage', 'forget', { part })
/** Unmount everything on the disk and detach it so it can be pulled. */
export const eject = (disk: string) => call<Reply>('luci.aw1000-storage', 'eject', { disk })
/** enable copies the overlay onto the partition (job) and needs a reboot. */
export const extroot = (part: string, action: 'enable' | 'disable') => call<Reply>('luci.aw1000-storage', 'extroot', { part, action })
export type Fs = 'ext4' | 'exfat' | 'vfat' | 'ntfs' | 'f2fs'
/** Whole-disk format (job). `confirm` must equal the disk name. */
export const format = (disk: string, fs: Fs, label: string, confirm: string) => call<Reply>('luci.aw1000-storage', 'format', { disk, fs, label, confirm })
export const settings = (automount: boolean, checkFs: boolean) =>
  call<Reply>('luci.aw1000-storage', 'settings', { automount: automount ? '1' : '0', check_fs: checkFs ? '1' : '0' })
export const reboot = () => call<Reply>('luci.aw1000-storage', 'reboot')
