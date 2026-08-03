export function isWindowsRuntime() {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform || ''
  const userAgent = navigator.userAgent || ''
  return /win/i.test(`${platform} ${userAgent}`)
}

export function isIOSRuntime() {
  if (typeof navigator === 'undefined') return false
  if (typeof document !== 'undefined' && document.documentElement.dataset.platform === 'ios') return true

  const userAgent = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const isTouchMac = /Mac/i.test(platform) && navigator.maxTouchPoints > 1
  return /iPhone|iPad|iPod/i.test(userAgent) || isTouchMac
}

export function getRuntimePlatform(): 'windows' | 'ios' | 'default' {
  if (isWindowsRuntime()) return 'windows'
  if (isIOSRuntime()) return 'ios'
  return 'default'
}

export function getWindowsVisualProfile() {
  return {
    targetFrameMs: 33,
    pixelRatio: 1,
    antialias: false,
  }
}

export function getIOSVisualProfile() {
  return {
    targetFrameMs: 42,
    pixelRatio: 1,
    antialias: false,
    maxBrainPoints: 820,
    maxBrainLines: 120,
    sparkCount: 4,
    maxGraphNodes: 140,
  }
}
