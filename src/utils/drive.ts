// What the setup wizard can offer for each drive plugged into the router -
// pure, so it is tested. The Storage step reads luci.aw1000-storage's status
// and asks this what each disk is good for right now.

import type { Disk, Partition, StorageStatus } from '@/api/storage'

/**
 * ready       a partition is mounted: use it as it is
 * unmounted   a partition the router can read, not mounted: mount it first
 * blank       no partition or no filesystem: it needs formatting
 * unsupported a filesystem the router can't use: formatting would make it usable
 * router      the router's own storage runs from it (extroot): histories kept
 *             "on the router" already land here
 */
export type DriveState = 'ready' | 'unmounted' | 'blank' | 'unsupported' | 'router'

export interface DriveOffer {
  disk: Disk
  part: Partition | null
  state: DriveState
  /** where its history would go: a mountpoint, "router" for extroot, or null until formatted */
  target: string | null
}

export function driveOffers(st: StorageStatus | null): DriveOffer[] {
  return (st?.disks ?? []).map((disk): DriveOffer => {
    const parts = disk.partitions ?? []
    if (parts.some((p) => p.mode === 'rootfs-active')) return { disk, part: null, state: 'router', target: 'router' }
    const data = parts.filter((p) => p.mode === 'data' || p.mode === 'none' || !p.mode)
    const mounted = data.find((p) => p.supported && p.mounted && p.mountpoint)
    if (mounted) return { disk, part: mounted, state: 'ready', target: mounted.mountpoint }
    const readable = data.find((p) => p.supported && p.fs)
    if (readable) return { disk, part: readable, state: 'unmounted', target: readable.target || `/mnt/${readable.name}` }
    if (parts.some((p) => p.fs)) return { disk, part: parts.find((p) => p.fs) ?? null, state: 'unsupported', target: null }
    return { disk, part: null, state: 'blank', target: null }
  })
}

/** Whether the drive needs formatting before anything can be kept on it. */
export const needsFormat = (o: DriveOffer) => o.state === 'blank' || o.state === 'unsupported'

/** "Generic Mass-Storage · 64 GB · USB 2.0" */
export function driveTitle(d: Disk): string {
  const name = [d.vendor, d.model].filter((x) => x && x.trim()).join(' ').trim() || d.name
  const gb = d.size / 1e9
  const size = gb >= 100 ? `${Math.round(gb)} GB` : gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(d.size / 1e6)} MB`
  const bus = d.usb_version ? `USB ${d.usb_version.replace(/^(\d+)\.(\d)0?$/, '$1.$2')}` : null
  return [name, size, bus].filter(Boolean).join(' · ')
}

/** The partition a format creates: sda -> sda1, mmcblk0 -> mmcblk0p1, nvme0n1 -> nvme0n1p1. */
export function firstPartition(disk: string): string {
  return /\d$/.test(disk) ? `${disk}p1` : `${disk}1`
}
