// Identifies the machine/browser this app instance runs on, so the super admin
// can see *where* each user is signed in from (User Accounts → Device).
//
// In the Electron app the real computer name comes from the preload bridge
// (os.hostname()). In a plain browser (customer mobile / web) there is no such
// API, so we derive a readable "Chrome on Windows" style label instead and pin
// it to a random per-device id kept in localStorage.

const DEVICE_ID_KEY = 'ideliver_device_id'

// Stable random id for this install/browser profile. Lets two identically named
// machines still be told apart.
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() ?? `d${Date.now()}${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

function browserLabel() {
  const ua = navigator.userAgent || ''
  const browser =
    /Edg\//.test(ua)                        ? 'Edge'    :
    /OPR\//.test(ua)                        ? 'Opera'   :
    /Chrome\//.test(ua)                     ? 'Chrome'  :
    /Firefox\//.test(ua)                    ? 'Firefox' :
    /Safari\//.test(ua)                     ? 'Safari'  : 'Browser'
  const os =
    /Windows/.test(ua)                      ? 'Windows' :
    /Android/.test(ua)                      ? 'Android' :
    /iPhone|iPad|iPod/.test(ua)             ? 'iOS'     :
    /Mac OS X/.test(ua)                     ? 'macOS'   :
    /Linux/.test(ua)                        ? 'Linux'   : 'Unknown OS'
  return `${browser} on ${os}`
}

const PLATFORM_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }

// Human-readable device name — the computer name inside Electron, otherwise a
// browser/OS description.
export function getDeviceName() {
  const d = globalThis.window?.electron?.device
  if (d?.name) {
    const os = PLATFORM_NAMES[d.platform] || d.platform
    return d.osUser ? `${d.name} (${d.osUser})` : `${d.name}${os ? ` · ${os}` : ''}`
  }
  return browserLabel()
}

export function getDeviceInfo() {
  const d = globalThis.window?.electron?.device
  return {
    device_id:       getDeviceId(),
    device_name:     getDeviceName(),
    device_platform: d?.platform || (navigator.platform || 'web'),
    is_desktop:      !!d?.name,
  }
}
