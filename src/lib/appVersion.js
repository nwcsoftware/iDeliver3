/* Single source of truth for the application name and version.

   Keep APP_VERSION in step with the "version" field in package.json — bump both
   together when releasing. Everything that displays the version (login screen,
   About popup, …) reads it from here, so there is only one place to change. */

export const APP_NAME    = 'iDeliver III'
export const APP_VERSION = '3.00.019'

/* "iDeliver III · v3.00.019" */
export const APP_VERSION_LABEL = `${APP_NAME} · v${APP_VERSION}`

/* ── ownership & attribution ──────────────────────────────────────────────────
   Kept here with the name and version so the public footer, the About popup and
   anything printed cannot drift apart into three different legal claims.

   ── On the symbols, because they are not interchangeable ─────────────────────
     ©  Copyright. Always correct on original work; needs no registration.
     ™  An UNREGISTERED trademark claim. Free to use on any mark you trade
        under, registered or not.
     ®  A REGISTERED trademark. Lawful only where the mark is actually on a
        trademark register, and only in the territories where it is registered.
        Using it otherwise is a false claim and a punishable offence in several
        jurisdictions (the EU, the UK and the US among them).

   These read ™ deliberately. Change a mark to ® only once you hold the
   registration certificate for it — and if the mark is registered in some
   countries but not others, ™ remains the safe choice on a public web page,
   which is read everywhere. */

export const PRODUCT_TITLE = 'Delivery Management Suite'
export const BRAND         = '3asari3'
export const BRAND_MARK    = '3asari3™'
export const VENDOR        = '_NXCORE'
export const VENDOR_MARK   = '_NXCORE™'
export const VENDOR_GROUP  = 'an NWC Group company'
export const OWNER         = 'Nicolas W. Chami'

/** "© 2026 3asari3. All rights reserved." — the year is always the current one. */
export const copyrightLine = (holder = BRAND) =>
  `© ${new Date().getFullYear()} ${holder}. All rights reserved.`

/* The reservation of rights in full, for the foot of a public page. Plain
   English on purpose: a notice nobody can read reserves nothing in practice. */
export const RIGHTS_NOTICE =
  'This software and its content are protected by copyright. '
  + 'No part may be reproduced, distributed or modified without written permission.'
