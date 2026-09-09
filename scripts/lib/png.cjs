/* A minimal PNG encoder.
 *
 * There is no image library in this project — no sharp, no canvas — and adding
 * one to draw placeholder pictures for seed data would be a poor trade. A PNG
 * is not much more than a zlib stream with four framed chunks around it, and
 * zlib is in Node already, so it is written out here instead.
 *
 * Truecolour, 8 bits a channel, no interlacing. That is all the seeder needs.
 */

const zlib = require('zlib')

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/* rgb: a Buffer of width*height*3 bytes, row-major.
 *
 * Every scanline is written with filter 1 (Sub) — each byte stored as its
 * difference from the pixel to its left. For the smooth gradients this file
 * exists to draw, that turns long runs of "almost the same colour" into long
 * runs of zeros, which is what deflate is good at. Filter 0 on the same image
 * is roughly four times the size. */
function encodePNG(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    raw[o] = 1
    for (let x = 0; x < stride; x++) {
      const cur = rgb[y * stride + x]
      const left = x >= 3 ? rgb[y * stride + x - 3] : 0
      raw[o + 1 + x] = (cur - left) & 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 2      // colour type: truecolour
  ihdr[10] = 0     // deflate
  ihdr[11] = 0     // adaptive filtering
  ihdr[12] = 0     // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

module.exports = { encodePNG }
