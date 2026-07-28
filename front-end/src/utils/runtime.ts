export function isWindowsRuntime() {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform || ''
  const userAgent = navigator.userAgent || ''
  return /win/i.test(`${platform} ${userAgent}`)
}

export function getWindowsVisualProfile() {
  return {
    targetFrameMs: 33,
    pixelRatio: 1,
    antialias: false,
  }
}
