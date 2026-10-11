import { describe, expect, it } from 'vitest'
import type { Disk, Partition, StorageStatus } from '@/api/storage'
import { driveOffers, driveTitle, firstPartition, needsFormat } from './drive'

const part = (p: Partial<Partition>): Partition => ({
  name: 'sda1', dev: '/dev/sda1', size: 64e9, fs: 'ext4', label: null, uuid: 'x', supported: true, mounted: false,
  mountpoint: null, total_kb: null, used_kb: null, free_kb: null, mode: 'data', fstab: null, enabled: true, options: null, ...p,
})
const disk = (partitions: Partition[], d: Partial<Disk> = {}): Disk => ({
  name: 'sda', dev: '/dev/sda', size: 63864569856, vendor: 'Generic', model: 'Mass-Storage', serial: '', usb_version: '2.00',
  speed_mbps: 480, removable: true, readonly: false, busy_job: false, partitions, ...d,
})
const st = (disks: Disk[]) => ({ ok: true, disks }) as unknown as StorageStatus

describe('drive offers', () => {
  it('uses a mounted partition as it is', () => {
    const [o] = driveOffers(st([disk([part({ mounted: true, mountpoint: '/mnt/sda1' })])]))
    expect(o!.state).toBe('ready')
    expect(o!.target).toBe('/mnt/sda1')
  })

  it('mounts a readable one first, where fstab says', () => {
    const [o] = driveOffers(st([disk([part({ target: '/mnt/data' })])]))
    expect(o!.state).toBe('unmounted')
    expect(o!.target).toBe('/mnt/data')
  })

  it('offers to format a blank or unreadable drive', () => {
    const [blank] = driveOffers(st([disk([])]))
    expect(blank!.state).toBe('blank')
    expect(needsFormat(blank!)).toBe(true)
    const [odd] = driveOffers(st([disk([part({ fs: 'hfsplus', supported: false })])]))
    expect(odd!.state).toBe('unsupported')
    expect(odd!.target).toBeNull()
  })

  it('knows the router runs from an extroot drive', () => {
    const [o] = driveOffers(st([disk([part({ mode: 'rootfs-active', mounted: true, mountpoint: '/overlay' })])]))
    expect(o).toMatchObject({ state: 'router', target: 'router' })
  })

  it('names drives and their first partition', () => {
    expect(driveTitle(disk([]))).toBe('Generic Mass-Storage · 64 GB · USB 2.0')
    expect(firstPartition('sda')).toBe('sda1')
    expect(firstPartition('mmcblk0')).toBe('mmcblk0p1')
  })

  it('has nothing to offer without drives', () => {
    expect(driveOffers(null)).toEqual([])
  })
})
