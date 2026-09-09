import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

/* Photographs of things that are for sale (supabase-fix143.sql).

   Shop items and catalogue products used to keep their pictures IN the row, as
   base64 data URLs, because `FileReader.readAsDataURL` is the shortest path
   from a file input to something you can put in a database. It is also the
   most expensive: measured on this install, four displayed items came to
   2423 KB and took 55 seconds, against 3 KB and half a second for the same
   rows with the image columns left out.

   Base64 in a row is slow in a way that compounds:

     · The bytes ride inside a JSON response, so the browser cannot cache them
       as images, cannot reuse them across screens, and cannot skip the ones
       below the fold. `loading="lazy"` does nothing for a data: URL — it was
       downloaded before the <img> existed.
     · Nothing renders until the last byte of the last photograph lands. The
       same weight in real image files would show the text at once and fill the
       pictures in as they arrive.
     · Every visit pays for all of it again.

   So a picture goes to the `shop-media` bucket and the row keeps a short URL.

   ── It is also made smaller on the way ──────────────────────────────────────
   The old limit was "under 750 KB" — a rule about the FILE, which a shop owner
   satisfies by finding a smaller photograph rather than by making the right
   one smaller. A modern phone camera produces 4000px images; a card in the
   customer app is a couple of inches wide. So the picture is redrawn through a
   canvas at MAX_EDGE before it is sent, which typically turns 3 MB of camera
   JPEG into 150 KB that looks identical at the size it is displayed. The owner
   picks the photograph they wanted and it simply works. */

export const MEDIA_BUCKET = 'shop-media'
export const MEDIA_FOLDER = 'items'

/* What actually leaves the phone. 1600px covers the largest place one of these
   is shown — the full-screen preview on a tablet — with room for a 2x display,
   and 0.82 JPEG is the point either side of which you are trading visible
   quality against bytes nobody notices. */
export const MAX_EDGE = 1600
export const QUALITY  = 0.82

/* A ceiling on the ORIGINAL, before it is redrawn. Not about the row any more —
   it is about not asking a browser to decode a 100 MP panorama on a phone. */
export const MAX_SOURCE_MB = 25

/* What the bucket accepts, and — the reason the list exists — what a browser
   will actually draw in an <img>. An iPhone shoots HEIC, which only Safari can
   decode: canvas cannot resize it, so it would sail through downscale()
   untouched, upload happily if the bucket let it, and then show as a broken
   picture in the customer app on every other device. Far better to say so at
   the point the owner picks the file. */
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif']

const mb = bytes => (bytes / 1024 / 1024).toFixed(1)

export const isStoredUpload = (url = '') =>
  /^https?:\/\//i.test(url) && String(url).includes(`/${MEDIA_BUCKET}/`)

/* Is this one of the old rows, with the picture still inside it? */
export const isDataUrl = (url = '') => /^data:image\//i.test(String(url || ''))

/* Redraw a picked file at a sane size.

   Returns a Blob, or the original file when it cannot be decoded — a shop owner
   with an image this browser dislikes should still get their upload, just
   without the shrinking. Anything already small enough is left alone rather
   than being re-encoded, which would only lose quality to no purpose. */
export function downscale(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('image/')) { resolve(file); return }
    // A GIF may be animated, and a canvas would flatten it to its first frame.
    if (/gif/i.test(file.type)) { resolve(file); return }

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const { width: w, height: h } = img
      const scale = Math.min(1, maxEdge / Math.max(w, h))
      // Already smaller than the ceiling and not a heavy file: leave it be.
      if (scale === 1 && file.size <= 400 * 1024) { resolve(file); return }
      try {
        const canvas = document.createElement('canvas')
        canvas.width  = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => resolve(blob && blob.size < file.size ? blob : file),
          'image/jpeg',
          quality,
        )
      } catch { resolve(file) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

const extOf = (file) => {
  const t = String(file?.type || '').toLowerCase()
  if (t.includes('png'))  return 'png'
  if (t.includes('webp')) return 'webp'
  if (t.includes('gif'))  return 'gif'
  return 'jpg'
}

/* Send one picture to the bucket and hand back its public URL.

   Over XHR rather than the storage client for the same reason the landing page
   uploader is: a photograph on a phone connection takes real time, and a form
   that looks frozen is a form people give up on. XHR reports progress; fetch
   does not. */
export function uploadShopImage(file, { onProgress = null, folder = MEDIA_FOLDER, maxEdge = MAX_EDGE } = {}) {
  return (async () => {
    if (!file) return { url: '', error: 'No file chosen.' }
    const type = String(file.type || '').toLowerCase()
    if (!type.startsWith('image/')) {
      return { url: '', error: 'Please choose an image file.' }
    }
    if (/hei[cf]/.test(type)) {
      return {
        url: '',
        error: 'That photo is in Apple’s HEIC format, which most browsers can’t display. '
             + 'In the Camera settings choose “Most Compatible”, or export it as JPEG first.',
      }
    }
    if (file.size > MAX_SOURCE_MB * 1024 * 1024) {
      return { url: '', error: `That picture is ${mb(file.size)} MB — please choose one under ${MAX_SOURCE_MB} MB.` }
    }

    const body  = await downscale(file, { maxEdge })
    // downscale() hands back the ORIGINAL when it cannot decode it or when it is
    // already small — so the type still has to be checked on the way out, not
    // only on the way in.
    if (!ACCEPTED.includes(String(body.type || '').toLowerCase())) {
      return { url: '', error: `That picture is a ${body.type || 'format'} the shop can’t display. Use JPG, PNG or WebP.` }
    }
    const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
    const rand  = Math.random().toString(36).slice(2, 8)
    const path  = `${folder}/${stamp}-${rand}.${extOf(body)}`
    const endpoint  = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`

    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', endpoint, true)
        xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
        xhr.setRequestHeader('authorization', `Bearer ${SUPABASE_ANON_KEY}`)
        xhr.setRequestHeader('x-upsert', 'false')
        // A year. The path carries a random suffix, so a URL never changes
        // meaning and the browser can hold on to the file for as long as it
        // likes — which is the whole point of getting these out of the row.
        xhr.setRequestHeader('cache-control', 'max-age=31536000')
        if (body.type) xhr.setRequestHeader('content-type', body.type)

        xhr.upload.onprogress = (ev) => {
          if (!onProgress) return
          onProgress(ev.lengthComputable ? Math.round((ev.loaded / ev.total) * 100) : null)
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { resolve({ url: publicUrl, error: null }); return }
          let msg = ''
          try { msg = JSON.parse(xhr.responseText || '{}').message || '' } catch { msg = xhr.responseText || '' }
          const lower = msg.toLowerCase()
          resolve({
            url: '',
            error:
              /bucket not found|nosuchbucket/.test(lower)
                ? 'The shop-media bucket isn’t there — run supabase-fix143.sql, then try again.'
              : /mime|invalid_mime_type/.test(lower)
                ? `That file type (${body.type || 'unknown'}) isn’t allowed. Use JPG, PNG or WebP.`
              : /exceeded|too large|payload/.test(lower)
                ? `The picture is ${mb(body.size)} MB — larger than storage will accept.`
              : (msg || `Upload failed (HTTP ${xhr.status}).`),
          })
        }
        xhr.onerror   = () => resolve({ url: '', error: 'The upload didn’t reach the server. Check the connection and try again.' })
        xhr.ontimeout = () => resolve({ url: '', error: 'The upload timed out.' })
        xhr.onabort   = () => resolve({ url: '', error: 'Upload cancelled.' })
        xhr.send(body)
      } catch (e) {
        resolve({ url: '', error: e?.message || 'Upload failed.' })
      }
    })
  })()
}

/* Best-effort tidy-up when a photograph is taken off an item. An orphaned file
   is a nuisance; an item that refuses to save is a bug, so a failure here never
   blocks anything. Only touches files we uploaded — a data: URL from before
   this migration, or someone's link to a picture elsewhere, is left alone. */
export async function removeShopImage(url) {
  if (!isStoredUpload(url)) return
  const path = String(url).split(`/${MEDIA_BUCKET}/`).pop()?.split('?')[0]
  if (!path) return
  try { await supabase.storage.from(MEDIA_BUCKET).remove([decodeURIComponent(path)]) } catch { /* ignore */ }
}
